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
import SimplePeer from 'simple-peer'
import { BufferedEventEmitter } from './utils'

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
        fastSyncChannelCreated: (channel: FastSyncChannel) => void
        connecting: () => void
        reconnected: () => void
        reconnect: (event: { attempt: number }) => void
        releasingSignalChannel: () => void
        connected: () => void
        preSyncSuccess: () => void
        finished: () => void
        peerCrashed: () => void
        crashed: () => void
    }

export interface InitialSyncDependencies {
    storageManager: StorageManager
    signalTransportFactory: SignalTransportFactory
    syncedCollections: string[]
    maxReconnectAttempts?: number
    getIceServers?: () => Promise<string[]>
    batchSize?: number
    debug?: boolean
}
export type SignalTransportFactory = () => SignalTransport

export const CONNECTION_MESSAGES = {
    requestReconnect: 'reconnect.req',
    confirmReconnect: 'reconnect.ack',
    peerCrash: 'crashed',
}

export class InitialSync {
    events = new EventEmitter() as TypedEmitter<InitialSyncEvents>
    debug: boolean
    wrtc?: any // Possibility for tests to inject wrtc library
    peerName?: string // Only used for debug logging

    private fastSyncInfo?: InitialSyncInfo

    private reconnectingPeer?: Promise<SimplePeer.Instance | null>
    private reconnectAttempt = 0
    private peerCrashed = false // An error occurred on the peer we're trying to sync to
    private crashed = false

    constructor(protected dependencies: InitialSyncDependencies) {
        this.debug = !!dependencies.debug
        const origEmit = this.events.emit.bind(this.events) as any
        this.events.emit = ((eventName: string, event: any) => {
            if (eventName !== 'fastSyncChannelCreated') {
                if (event) {
                    this._debugLog(`Event '${eventName}':`, event)
                } else {
                    this._debugLog(`Event '${eventName}'`)
                }
            }
            return origEmit(eventName, event)
        }) as any
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

    async abortInitialSync(): Promise<void> {
        if (!this.fastSyncInfo) {
            return
        }

        await this.fastSyncInfo.fastSync.abort()
        await this.cleanupInitialSync()
    }

    async cleanupInitialSync() {
        if (!this.fastSyncInfo) {
            return
        }

        this.reconnectAttempt = 0
        delete this.reconnectingPeer
        this.crashed = false
        this.peerCrashed = false

        const info = this.fastSyncInfo
        delete this.fastSyncInfo

        this.events.emit('releasingSignalChannel')
        await info.signalChannel.release()

        info.events.emit = () => false
        await Promise.race([
            new Promise(resolve => setTimeout(resolve, 1000)),
            info.fastSyncChannel.destroy(),
        ])
    }

    async cancelInitialSync() {
        if (!this.fastSyncInfo) {
            return
        }

        await this.fastSyncInfo.fastSync.cancel()
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
        await this.cleanupInitialSync()

        const signalChannel = await options.signalTransport.openChannel(
            pick(options, 'initialMessage', 'deviceId'),
        )
        signalChannel.events = new BufferedEventEmitter() as any

        const fastSyncChannel = await this.createFastSyncChannel({
            role: options.role,
            signalChannel,
        })
        this.events.emit('fastSyncChannelCreated', fastSyncChannel.channel)

        signalChannel.events.on('userMessage', ({ message }) => {
            if (message === CONNECTION_MESSAGES.requestReconnect) {
                fastSyncChannel.channel.replacePeer(
                    this.attemptReconnect({
                        role: options.role,
                        signalChannel,
                        reason: 'requested',
                    }),
                )
            } else if (message === CONNECTION_MESSAGES.peerCrash) {
                this.events.emit('peerCrashed')
                this.peerCrashed = true
                this.abortInitialSync()
            }
        })

        const fastSync = new FastSync({
            storageManager: this.dependencies.storageManager,
            channel: fastSyncChannel.channel,
            collections: this.dependencies.syncedCollections,
            preSendProcessor: this.getPreSendProcessor() || undefined,
            batchSize: this.dependencies.batchSize,
        })
        fastSync.events.on = ((eventName: any, event: any) => {
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
            this.events.emit('connecting')
            await fastSyncChannel.setup()
            this.events.emit('connected')

            try {
                await this.preSync(buildInfo())
                this.events.emit('preSyncSuccess')
                const fastSyncInfo = await getFastSyncInfo(
                    this.dependencies.storageManager,
                    { collections: this.dependencies.syncedCollections },
                )
                const syncOrder = await this.negiotiateSyncOrder({
                    role: options.role,
                    channel: fastSyncChannel.channel,
                    fastSyncInfo,
                })
                try {
                    await fastSync.execute({
                        role: options.role,
                        bothWays: syncOrder,
                        fastSyncInfo,
                    })
                } catch (e) {
                    if (e.name !== 'ChannelDestroyedError') {
                        throw e
                    }
                }
                this.events.emit('finished')

                if (!options.preserveChannel) {
                    await this.cleanupInitialSync()
                }
            } catch (e) {
                this.crashed = true
                this.fastSyncInfo?.fastSync?.abort?.()
                this.events.emit('error', { error: e })
                signalChannel.sendUserMessage(CONNECTION_MESSAGES.peerCrash)
                throw e
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
            return localStorageSize > remoteStorageSize
                ? 'receive-first'
                : 'send-first'
        }
    }

    getPreSendProcessor(): FastSyncPreSendProcessor | void { }
    async preSync(options: InitialSyncInfo) { }

    async getPeer(options: { initiator: boolean }): Promise<Peer.Instance> {
        let iceServers = undefined
        try {
            iceServers = await this.dependencies.getIceServers?.()
        } catch (e) {
            console.warn('An error occured while trying to get ICE servers, ignoring...')
            console.warn(e)
        }
        return new Peer({
            initiator: options.initiator,
            wrtc: this.wrtc,
            ...(iceServers
                ? {
                    config: {
                        iceServers,
                    },
                }
                : {}),
        })
    }

    shouldAttemptReconnect = () => {
        if (
            !this.dependencies.maxReconnectAttempts ||
            this.peerCrashed ||
            this.crashed
        ) {
            return false
        }

        return this.reconnectAttempt < this.dependencies.maxReconnectAttempts
    }

    attemptReconnect = async (options: {
        role: FastSyncRole
        signalChannel: SignalChannel
        reason: 'stalled' | 'requested'
    }): Promise<SimplePeer.Instance | null> => {
        if (this.reconnectingPeer) {
            return this.reconnectingPeer
        }
        await options.signalChannel.sendUserMessage(
            options.reason === 'stalled'
                ? CONNECTION_MESSAGES.requestReconnect
                : CONNECTION_MESSAGES.confirmReconnect,
        )

        console.log('start reconnecting')
        const peer = (this.reconnectingPeer = (async () => {
            console.log('entering promise')
            this.reconnectAttempt = 0
            while (this.shouldAttemptReconnect()) {
                console.log('another attempt', this.reconnectAttempt)
                this.reconnectAttempt += 1
                this.events.emit('reconnect', {
                    attempt: this.reconnectAttempt,
                })
                try {
                    const peer = await this.recreatePeer(options)
                    this.events.emit('reconnected')
                    this.reconnectAttempt = 0
                    return peer
                } catch (err) {
                    continue
                }
            }

            return null
        })())

        return peer
    }

    private signalSimplePeer = async (options: {
        role: FastSyncRole
        signalChannel: SignalChannel
        peer: SimplePeer.Instance
        alreadyConnected?: boolean
    }) => {
        if (!options.alreadyConnected) {
            await options.signalChannel.connect()
        }
        await signalSimplePeer({
            signalChannel: options.signalChannel,
            simplePeer: options.peer,
            reporter: (eventName, event) =>
                (this.events as any).emit(eventName, event),
        })
    }

    async recreatePeer(options: {
        role: FastSyncRole
        signalChannel: SignalChannel
    }) {
        const peer = await this.getPeer({
            initiator: options.role === 'receiver',
        })
        await this.signalSimplePeer({
            ...options,
            peer,
            alreadyConnected: true,
        })
        return peer
    }

    async createFastSyncChannel(options: {
        role: FastSyncRole
        signalChannel: SignalChannel
    }) {
        const peer = await this.getPeer({
            initiator: options.role === 'receiver',
        })

        const channel = new WebRTCFastSyncChannel({
            peer,
            shouldAttemptReconnect: this.shouldAttemptReconnect,
            reconnect: () =>
                this.attemptReconnect({
                    ...options,
                    reason: 'stalled',
                }),
        })

        return {
            channel,
            setup: () => this.signalSimplePeer({ ...options, peer }),
        }
    }

    count = 0
    _debugLog(...args: any[]) {
        if (this.debug && ++this.count < 500) {
            const peerName = this.peerName ? ` ${this.peerName} -` : ``
            console['log'](`Initial Sync -${peerName}`, ...args)
        }
    }
}
