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
        finished: {}
    }

export interface InitialSyncDependencies {
    storageManager: StorageManager
    signalTransportFactory: SignalTransportFactory
    syncedCollections: string[]
}

export type SignalTransportFactory = () => SignalTransport
export class InitialSync {
    public wrtc: any // Possibility for tests to inject wrtc library
    private initialSyncInfo?: InitialSyncInfo

    constructor(protected dependencies: InitialSyncDependencies) {}

    async requestInitialSync(): Promise<{ initialMessage: string }> {
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
        })

        return { initialMessage }
    }

    async answerInitialSync(options: {
        initialMessage: string
    }): Promise<void> {
        const role = 'receiver'
        const { signalTransport } = await this._createSignalTransport(role)
        this.initialSyncInfo = await this._setupInitialSync({
            role,
            signalTransport,
            initialMessage: options.initialMessage,
            deviceId: 'second',
        })
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
        let senderFastSync: FastSyncSender | undefined
        let receiverFastSync: FastSyncReceiver | undefined
        let fastSync: {
            execute: () => Promise<void>
            events: TypedEmitter<FastSyncEvents & InitialSyncEvents>
        }

        if (options.role === 'sender') {
            senderFastSyncChannel = new WebRTCFastSyncSenderChannel({ peer })
            senderFastSync = new FastSyncSender({
                storageManager: this.dependencies.storageManager,
                channel: senderFastSyncChannel,
                collections: this.dependencies.syncedCollections,
                preSendProcessor: this.getPreSendProcessor() || undefined,
            })
            fastSync = senderFastSync
        } else {
            receiverFastSyncChannel = new WebRTCFastSyncReceiverChannel({
                peer,
            })
            receiverFastSync = new FastSyncReceiver({
                storageManager: this.dependencies.storageManager,
                channel: receiverFastSyncChannel,
            })
            fastSync = receiverFastSync
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
            await fastSync.execute()
            fastSync.events.emit('finished', {})
        })()

        return buildInfo()
    }

    protected getPreSendProcessor(): FastSyncPreSendProcessor | void {}

    protected async preSync(options: InitialSyncInfo) {}
}
