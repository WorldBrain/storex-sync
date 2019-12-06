import pick from 'lodash/pick'
import Peer from 'simple-peer'
import { SignalTransport, SignalChannel } from 'simple-signalling/lib/types'
import {
    signalSimplePeer,
    SimplePeerSignallingEvents,
} from 'simple-signalling/lib/simple-peer'
import {
    FastSyncEvents,
    FastSyncPreSendProcessor,
    FastSync,
} from '../fast-sync'
import { WebRTCFastSyncChannel } from '../fast-sync/channels'
import TypedEmitter from 'typed-emitter'
import StorageManager from '@worldbrain/storex'
import {
    FastSyncChannel,
    FastSyncRole,
    FastSyncOrder,
    FastSyncInfo,
} from '../fast-sync/types'
import { resolvablePromise, getFastSyncInfo } from '../fast-sync/utils'
import { EventEmitter } from 'events'

export type InitialSyncInfo = {
    signalChannel: SignalChannel
    events: TypedEmitter<InitialSyncEvents>
    finishPromise: Promise<void>
    role: FastSyncRole
    fastSyncChannel: FastSyncChannel
    fastSync: FastSync
}

export type InitialSyncEvents = FastSyncEvents &
    SimplePeerSignallingEvents & {
        connecting: {}
        releasingSignalChannel: {}
        connected: {}
        preSyncSuccess: {}
        finished: {}
    }

export interface InitialSyncDependencies {
    storageManager: StorageManager
    signalTransportFactory: SignalTransportFactory
    syncedCollections: string[]
    debug?: boolean
}

export type SignalTransportFactory = () => SignalTransport
export class InitialSync {
    events = new EventEmitter() as TypedEmitter<InitialSyncEvents>

    public debug: boolean
    public wrtc?: any // Possibility for tests to inject wrtc library

    private fastSyncInfo?: InitialSyncInfo

    constructor(protected dependencies: InitialSyncDependencies) {
        this.debug = !!dependencies.debug
    }

    async requestInitialSync(options?: {
        preserveChannel?: boolean
    }): Promise<{ initialMessage: string }> {
        const role = 'sender'
        const {
            signalTransport,
            initialMessage,
        } = await this._createSignalTransport(role)
        this.fastSyncInfo = await this._setupInitialSync({
            role,
            signalTransport,
            initialMessage,
            deviceId: 'first',
            ...(options || {}),
        })

        return { initialMessage }
    }

    async answerInitialSync(options: {
        initialMessage: string
        preserveChannel?: boolean
    }): Promise<void> {
        const role = 'receiver'
        const { signalTransport } = await this._createSignalTransport(role)
        this.fastSyncInfo = await this._setupInitialSync({
            role,
            signalTransport,
            deviceId: 'second',
            ...options,
        })
    }

    async waitForInitialSyncConnected() {
        if (!this.fastSyncInfo) {
            throw new Error(
                'Cannot wait for initial sync connection if it has not been started, or already finished',
            )
        }

        const connected = resolvablePromise<void>()
        const handler = () => {
            connected.resolve()
        }
        this.fastSyncInfo.events.on('connected', handler)
        await connected.promise
        this.fastSyncInfo.events.removeListener('connected', handler)
    }

    async waitForInitialSync(): Promise<void> {
        if (this.fastSyncInfo) {
            await this.fastSyncInfo.finishPromise
        }
    }

    _createSignalTransport(
        role: 'sender',
    ): Promise<{ signalTransport: SignalTransport; initialMessage: string }>
    _createSignalTransport(
        role: 'receiver',
    ): Promise<{ signalTransport: SignalTransport }>
    async _createSignalTransport(
        role: FastSyncRole,
    ): Promise<{
        signalTransport: SignalTransport
        initialMessage: string | undefined
    }> {
        const signalTransport: SignalTransport = this.dependencies.signalTransportFactory()
        return {
            signalTransport,
            initialMessage:
                role === 'sender'
                    ? (await signalTransport.allocateChannel()).initialMessage
                    : undefined,
        }
    }

    async _setupInitialSync(options: {
        role: FastSyncRole
        signalTransport: SignalTransport
        initialMessage: string
        deviceId: 'first' | 'second'
        preserveChannel?: boolean
    }): Promise<InitialSyncInfo> {
        const signalChannel = await options.signalTransport.openChannel(
            pick(options, 'initialMessage', 'deviceId'),
        )

        const fastSyncChannel = await this.createFastSyncChannel({
            role: options.role,
            signalChannel,
        })
        const fastSync = new FastSync({
            storageManager: this.dependencies.storageManager,
            channel: fastSyncChannel.channel,
            collections: this.dependencies.syncedCollections,
            preSendProcessor: this.getPreSendProcessor() || undefined,
        })
        fastSync.events.emit = ((eventName: any, event: any) => {
            return this.events.emit(eventName, event)
        }) as any

        const buildInfo = (): InitialSyncInfo => {
            return {
                role: options.role,
                signalChannel,
                finishPromise,
                events: fastSync.events,
                fastSync,
                fastSyncChannel: fastSyncChannel.channel,
            }
        }

        const finishPromise: Promise<void> = (async () => {
            const origEmit = this.events.emit.bind(this.events) as any
            this.events.emit = ((eventName: string, event: any) => {
                this._debugLog(`Event '${eventName}':`, event)
                return origEmit(eventName, event)
            }) as any

            this.events.emit('connecting', {})
            await fastSyncChannel.setup()
            this.events.emit('connected', {})

            await this.preSync(buildInfo())
            this.events.emit('preSyncSuccess', {})
            const fastSyncInfo = await getFastSyncInfo(
                this.dependencies.storageManager,
            )
            const syncOrder = await this.negiotiateSyncOrder({
                role: options.role,
                channel: fastSyncChannel.channel,
                fastSyncInfo,
            })
            await fastSync.execute({
                role: options.role,
                bothWays: syncOrder,
                fastSyncInfo,
            })
            this.events.emit('finished', {})

            if (!options.preserveChannel) {
                await fastSyncChannel.channel.destroy()
            }
        })()

        return buildInfo()
    }

    async negiotiateSyncOrder(params: {
        role: FastSyncRole
        channel: FastSyncChannel
        fastSyncInfo: FastSyncInfo
    }): Promise<FastSyncOrder> {
        const { channel } = params

        const localStorageSize = params.fastSyncInfo.objectCount
        if (params.role === 'sender') {
            await channel.sendUserPackage({
                type: 'storage-size',
                size: localStorageSize,
            })
            const remoteStorageSize = (
                await channel.receiveUserPackage({
                    expectedType: 'storage-size',
                })
            ).size
            return localStorageSize >= remoteStorageSize
                ? 'receive-first'
                : 'send-first'
        } else {
            const remoteStorageSize = (
                await channel.receiveUserPackage({
                    expectedType: 'storage-size',
                })
            ).size
            await channel.sendUserPackage({
                type: 'storage-size',
                size: localStorageSize,
            })
            return localStorageSize >= remoteStorageSize
                ? 'receive-first'
                : 'send-first'
        }
    }

    getPreSendProcessor(): FastSyncPreSendProcessor | void {}
    async preSync(options: InitialSyncInfo) {}

    async getPeer(options: { initiator: boolean }): Promise<Peer.Instance> {
        return new Peer({
            initiator: options.initiator,
            wrtc: this.wrtc,
        })
    }

    async createFastSyncChannel(options: {
        role: FastSyncRole
        signalChannel: SignalChannel
    }) {
        const peer = await this.getPeer({
            initiator: options.role === 'receiver',
        })
        const channel: FastSyncChannel = new WebRTCFastSyncChannel({
            peer,
        })
        return {
            channel,
            setup: async () => {
                await options.signalChannel.connect()
                await signalSimplePeer({
                    signalChannel: options.signalChannel,
                    simplePeer: peer,
                    reporter: (eventName, event) =>
                        (this.events as any).emit(eventName, event),
                })
                this.events.emit('releasingSignalChannel', {})
                await options.signalChannel.release()
            },
        }
    }

    _debugLog(...args: any[]) {
        if (this.debug) {
            console['log']('Initial Sync -', ...args)
        }
    }
}
