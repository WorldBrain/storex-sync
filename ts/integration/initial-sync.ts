import pick from 'lodash/pick'
import Peer from 'simple-peer'
import { SignalTransport, SignalChannel } from 'simple-signalling/lib/types'
import {
    signalSimplePeer,
    SimplePeerSignallingEvents,
} from 'simple-signalling/lib/simple-peer'
import {
    FastSyncSender,
    FastSyncReceiver,
    FastSyncEvents,
    FastSyncPreSendProcessor,
} from '../fast-sync'
import {
    WebRTCFastSyncSenderChannel,
    WebRTCFastSyncReceiverChannel,
} from '../fast-sync/channels'
import TypedEmitter from 'typed-emitter'
import StorageManager from '@worldbrain/storex'
import {
    FastSyncSenderChannel,
    FastSyncReceiverChannel,
} from '../fast-sync/types'
import { resolvablePromise } from '../fast-sync/utils'

export type InitialSyncInfo = {
    signalChannel: SignalChannel
    events: TypedEmitter<InitialSyncEvents>
    finishPromise: Promise<void>
} & (
        | {
            role: 'sender'
            senderFastSyncChannel: FastSyncSenderChannel
            senderFastSync: FastSyncSender
        }
        | {
            role: 'receiver'
            receiverFastSyncChannel: FastSyncReceiverChannel
            receiverFastSync: FastSyncReceiver
        })

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
    public wrtc: any // Possibility for tests to inject wrtc library
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
            ...(options || {})
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
            throw new Error('Cannot wait for initial sync connection if it has not been started, or already finished')
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
        const peer = new Peer({
            initiator: options.role === 'receiver',
            wrtc: this.wrtc,
        })

        let senderFastSyncChannel: FastSyncSenderChannel | undefined
        let receiverFastSyncChannel: FastSyncReceiverChannel | undefined
        let fastSyncChannel: { destroy: () => Promise<void> }

        let senderFastSync: FastSyncSender | undefined
        let receiverFastSync: FastSyncReceiver | undefined
        let fastSync: {
            execute: () => Promise<void>
            events: TypedEmitter<FastSyncEvents & InitialSyncEvents>
        }

        if (options.role === 'sender') {
            fastSyncChannel = senderFastSyncChannel = new WebRTCFastSyncSenderChannel({ peer })
            fastSync = senderFastSync = new FastSyncSender({
                storageManager: this.dependencies.storageManager,
                channel: senderFastSyncChannel,
                collections: this.dependencies.syncedCollections,
                preSendProcessor: this.getPreSendProcessor() || undefined,
            })
        } else {
            fastSyncChannel = receiverFastSyncChannel = new WebRTCFastSyncReceiverChannel({
                peer,
            })
            fastSync = receiverFastSync = new FastSyncReceiver({
                storageManager: this.dependencies.storageManager,
                channel: receiverFastSyncChannel,
            })
        }

        const buildInfo = (): InitialSyncInfo => {
            const common = {
                signalChannel,
                finishPromise,
                events: fastSync.events,
            }
            if (options.role === 'sender') {
                return {
                    role: 'sender',
                    ...common,
                    senderFastSync: senderFastSync!,
                    senderFastSyncChannel: senderFastSyncChannel!,
                }
            } else {
                return {
                    role: 'receiver',
                    ...common,
                    receiverFastSync: receiverFastSync!,
                    receiverFastSyncChannel: receiverFastSyncChannel!,
                }
            }
        }

        const finishPromise: Promise<void> = (async () => {
            const origEmit = fastSync.events.emit.bind(fastSync.events) as any
            fastSync.events.emit = ((eventName: string, event: any) => {
                this._debugLog(`Event '${eventName}':`, event)
                return origEmit(eventName, event)
            }) as any

            fastSync.events.emit('connecting', {})
            await signalChannel.connect()
            await signalSimplePeer({
                signalChannel,
                simplePeer: peer,
                reporter: (eventName, event) =>
                    (fastSync.events as any).emit(eventName, event),
            })
            fastSync.events.emit('releasingSignalChannel', {})
            await signalChannel.release()
            fastSync.events.emit('connected', {})

            await this.preSync(buildInfo())
            fastSync.events.emit('preSyncSuccess', {})
            await fastSync.execute()
            fastSync.events.emit('finished', {})

            if (!options.preserveChannel) {
                fastSyncChannel.destroy()
            }
        })()

        return buildInfo()
    }

    getPreSendProcessor(): FastSyncPreSendProcessor | void { }

    async preSync(options: InitialSyncInfo) { }

    _debugLog(...args: any[]) {
        if (this.debug) {
            console['log']("Initial Sync -", ...args)
        }
    }
}
