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
import { FastSyncChannel } from '../fast-sync/types'
import { resolvablePromise } from '../fast-sync/utils'

export type InitialSyncInfo = {
    signalChannel: SignalChannel
    events: TypedEmitter<InitialSyncEvents>
    finishPromise: Promise<void>
    role: 'sender' | 'receiver'
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
    public debug: boolean
    public wrtc?: any // Possibility for tests to inject wrtc library
    private initialSyncInfo?: InitialSyncInfo

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
        this.initialSyncInfo = await this._setupInitialSync({
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
        this.initialSyncInfo = await this._setupInitialSync({
            role,
            signalTransport,
            deviceId: 'second',
            ...options,
        })
    }

    async waitForInitialSyncConnected() {
        if (!this.initialSyncInfo) {
            throw new Error(
                'Cannot wait for initial sync connection if it has not been started, or already finished',
            )
        }

        const connected = resolvablePromise<void>()
        const handler = () => {
            connected.resolve()
        }
        this.initialSyncInfo.events.on('connected', handler)
        await connected.promise
        this.initialSyncInfo.events.removeListener('connected', handler)
    }

    async waitForInitialSync(): Promise<void> {
        if (this.initialSyncInfo) {
            await this.initialSyncInfo.finishPromise
        }
    }

    _createSignalTransport(
        role: 'sender',
    ): Promise<{ signalTransport: SignalTransport; initialMessage: string }>
    _createSignalTransport(
        role: 'receiver',
    ): Promise<{ signalTransport: SignalTransport }>
    async _createSignalTransport(
        role: 'sender' | 'receiver',
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
        role: 'sender' | 'receiver'
        signalTransport: SignalTransport
        initialMessage: string
        deviceId: 'first' | 'second'
        preserveChannel?: boolean
    }): Promise<InitialSyncInfo> {
        const signalChannel = await options.signalTransport.openChannel(
            pick(options, 'initialMessage', 'deviceId'),
        )
        const peer = await this.getPeer({
            initiator: options.role === 'receiver',
        })

        let fastSyncChannel: FastSyncChannel = new WebRTCFastSyncChannel({
            peer,
        })
        let fastSync = new FastSync({
            storageManager: this.dependencies.storageManager,
            channel: fastSyncChannel,
            collections: this.dependencies.syncedCollections,
            preSendProcessor: this.getPreSendProcessor() || undefined,
        })

        const buildInfo = (): InitialSyncInfo => {
            return {
                role: options.role,
                signalChannel,
                finishPromise,
                events: fastSync.events,
                fastSync,
                fastSyncChannel,
            }
        }

        const events = fastSync.events as TypedEmitter<InitialSyncEvents>
        const finishPromise: Promise<void> = (async () => {
            const origEmit = fastSync.events.emit.bind(fastSync.events) as any
            events.emit = ((eventName: string, event: any) => {
                this._debugLog(`Event '${eventName}':`, event)
                return origEmit(eventName, event)
            }) as any

            events.emit('connecting', {})
            await signalChannel.connect()
            await signalSimplePeer({
                signalChannel,
                simplePeer: peer,
                reporter: (eventName, event) =>
                    (fastSync.events as any).emit(eventName, event),
            })
            events.emit('releasingSignalChannel', {})
            await signalChannel.release()
            events.emit('connected', {})

            await this.preSync(buildInfo())
            events.emit('preSyncSuccess', {})
            await fastSync.execute({ role: options.role })
            events.emit('finished', {})

            if (!options.preserveChannel) {
                fastSyncChannel.destroy()
            }
        })()

        return buildInfo()
    }

    getPreSendProcessor(): FastSyncPreSendProcessor | void {}
    async preSync(options: InitialSyncInfo) {}

    async getPeer(options: { initiator: boolean }): Promise<Peer.Instance> {
        return new Peer({
            initiator: options.initiator,
            wrtc: this.wrtc,
        })
    }

    _debugLog(...args: any[]) {
        if (this.debug) {
            console['log']('Initial Sync -', ...args)
        }
    }
}
