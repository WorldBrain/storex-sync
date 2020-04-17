import { EventEmitter } from 'events'
import TypedEmitter from 'typed-emitter'
import { jsonDateParser } from 'json-date-parser'
import * as SimplePeer from 'simple-peer'
import {
    FastSyncBatch,
    FastSyncInfo,
    FastSyncPackage,
    FastSyncChannelEvents,
    FastSyncChannel,
} from './types'
import { ResolvablePromise, resolvablePromise, splitWithTail } from './utils'
import {
    calculateStringChunkCount,
    getStringChunk,
    receiveInChucks,
    sendInChunks,
} from './chunking'
import Interruptable from './interruptable'
import pick from 'lodash/pick'

export class ChannelDestroyedError extends Error {
    name = 'ChannelDestroyedError'
}

abstract class FastSyncChannelBase<UserPackageType> implements FastSyncChannel {
    events = new EventEmitter() as TypedEmitter<FastSyncChannelEvents>

    timeoutInMiliseconds = 10 * 1000
    preSend?: (syncPackage: FastSyncPackage) => Promise<void>
    postReceive?: (syncPackage: FastSyncPackage) => Promise<void>
    peerName?: string

    private _packageCounter = 0

    abstract _sendPackage(
        syncPackage: FastSyncPackage,
        options: {
            interruptable: Interruptable
            packageIndex: number
        },
    ): Promise<void>
    abstract _receivePackage(options: {
        interruptable: Interruptable
        packageIndex: number
    }): Promise<FastSyncPackage>

    abstract destroy(): Promise<void>

    async sendUserPackage(jsonSerializable: any): Promise<void> {
        await this._sendPackageSafely({
            type: 'user-package',
            package: jsonSerializable,
        })
    }

    async receiveUserPackage(options?: {
        expectedType?: keyof UserPackageType
    }): Promise<UserPackageType> {
        const userPackage = await this._receivePackageSafely()
        if (userPackage.type === 'user-package') {
            const innerPackage = userPackage.package
            if (
                options?.expectedType &&
                innerPackage.type !== options.expectedType
            ) {
                throw new Error(
                    `Expected user package with type ${options.expectedType} ` +
                        `in fast sync WebRTC channel, but got ` +
                        `user package with type ${innerPackage.type}`,
                )
            }
            return innerPackage
        } else {
            throw new Error(
                `Expected user package in fast sync WebRTC channel, but got package type ${userPackage.type}`,
            )
        }
    }

    async *streamObjectBatches(): AsyncIterableIterator<{
        collection: string
        objects: any[]
    }> {
        while (true) {
            const syncPackage: FastSyncPackage = await this._receivePackageSafely()
            if (syncPackage.type === 'finish') {
                break
            }
            if (syncPackage.type === 'state-change') {
                this.events.emit(
                    syncPackage.state === 'running' ? 'resumed' : 'paused',
                )
                continue
            }

            if (syncPackage.type === 'batch') {
                yield syncPackage.batch
            } else {
                throw new Error(
                    `Expected batch package in fast sync WebRTC channel, but got package type ${syncPackage.type}`,
                )
            }
        }
    }

    async receiveSyncInfo() {
        const syncPackage: FastSyncPackage = await this._receivePackageSafely()
        if (syncPackage.type !== 'sync-info') {
            throw new Error(
                `Received package with unexpected type while waiting for initial Sync info: ${syncPackage.type}`,
            )
        }
        return syncPackage.info
    }

    async sendSyncInfo(info: FastSyncInfo) {
        await this._sendPackageSafely({ type: 'sync-info', info })
    }

    async sendObjectBatch(batch: FastSyncBatch) {
        await this._sendPackageSafely({ type: 'batch', batch })
    }

    async sendStateChange(state: 'paused' | 'running'): Promise<void> {
        await this._sendPackageSafely({ type: 'state-change', state })
    }

    async finish() {
        await this._sendPackageSafely({ type: 'finish' })
    }

    async _receivePackageSafely() {
        const packageIndex = ++this._packageCounter
        this._debugLog('receiving package safely')
        const syncPackage = await this._withStallingDetection(interruptable =>
            this._receivePackage({ interruptable, packageIndex }),
        )
        this._debugLog('received package safely', syncPackage)

        if (this.postReceive) {
            await this.postReceive(syncPackage)
        }

        return syncPackage
    }

    async _sendPackageSafely(
        syncPackage: FastSyncPackage<UserPackageType, false>,
    ) {
        const packageIndex = ++this._packageCounter
        this._debugLog('sending package safely', syncPackage)
        const syncPackageWithIndex: FastSyncPackage<UserPackageType> = {
            ...syncPackage,
            index: packageIndex,
        }
        if (this.preSend) {
            await this.preSend(syncPackageWithIndex)
        }

        await this._withStallingDetection(interruptable =>
            this._sendPackage(syncPackageWithIndex, {
                interruptable,
                packageIndex,
            }),
        )
        this._debugLog('sent package safely', syncPackage)
    }

    async _withStallingDetection<T>(
        f: (interruptable: Interruptable) => Promise<T>,
    ) {
        while (true) {
            const interruptable = new Interruptable({ throwOnCancelled: true })
            const outcome = await Promise.race([
                new Promise<{ type: 'success'; value: T }>(
                    async (resolve, reject) => {
                        try {
                            resolve({
                                type: 'success',
                                value: await f(interruptable),
                            })
                        } catch (e) {
                            reject(e)
                        }
                    },
                ),
                new Promise<{ type: 'timeout' }>(resolve =>
                    setTimeout(
                        () => resolve({ type: 'timeout' }),
                        this.timeoutInMiliseconds,
                    ),
                ),
            ])

            // this._debugLog({ outcome })

            if (outcome.type === 'success') {
                return outcome.value
            }
            await interruptable.cancel()

            this._debugLog('timeout, so reconnect')

            if (!this.shouldAttemptReconnect()) {
                this.events.emit('stalled')
                await this.waitForNewConnection()
            }

            this._debugLog('should attempt')

            const reconnected = await this.attemptReconnect()
            if (!reconnected) {
                this._debugLog('could not reconnect, so waiting')
                this.events.emit('stalled')
                await this.waitForNewConnection()
            }

            this._debugLog('reconnected, so retrying')
        }
    }

    async waitForNewConnection() {
        await new Promise(resolve => {})
    }

    shouldAttemptReconnect() {
        return false
    }

    async attemptReconnect(): Promise<boolean> {
        return false
    }

    _debugLog(...args: any[]) {
        console.log(
            `${this.peerName}, package ${this._packageCounter}`,
            ...args,
        )
    }
}

export class WebRTCFastSyncChannel<UserPackageType> extends FastSyncChannelBase<
    UserPackageType
> {
    dataReceived = resolvablePromise<string>()
    dataHandler: (data: any) => void

    private destroyed = false
    private peer: Promise<SimplePeer.Instance | null>
    private newPeer = resolvablePromise<SimplePeer.Instance>()

    constructor(
        private options: {
            peer: SimplePeer.Instance
            shouldAttemptReconnect?: () => boolean
            reconnect?: () => Promise<SimplePeer.Instance | null>
        },
    ) {
        super()
        this.peer = Promise.resolve(options.peer)

        this.dataHandler = (data: any) => {
            // This promise gets replaced after each received package
            // NOTE: This assumes package are sent and confirmed one by one
            this.dataReceived.resolve(data.toString())
        }

        this.setupPeer(options.peer)
    }

    replacePeer(eventualPeer: Promise<SimplePeer.Instance | null>) {
        this.peer = (async () => {
            const currentPeer = await this.peer
            if (currentPeer) {
                currentPeer.removeListener('data', this.dataHandler)
                currentPeer.destroy()
            }
            this.dataReceived = resolvablePromise()

            const peer = await eventualPeer
            if (peer) {
                this.setupPeer(peer)
                this.newPeer.resolve(peer)
                this.newPeer = resolvablePromise()
            }
            return peer
        })()
    }

    shouldAttemptReconnect() {
        return this.options?.shouldAttemptReconnect?.() ?? false
    }

    async attemptReconnect() {
        if (!this.options.reconnect) {
            return false
        }

        this.replacePeer(this.options.reconnect())
        try {
            const peer = await this.peer
            return !!peer
        } catch (e) {
            console.error('Error during reconnect')
            console.error(e)
            return false
        }
    }

    async waitForNewConnection() {
        await this.newPeer.promise
    }

    async waitForPeer(): Promise<SimplePeer.Instance> {
        const peer = await this.peer
        if (peer) {
            return peer
        }
        return this.newPeer.promise
    }

    private setupPeer(peer: SimplePeer.Instance) {
        peer.on('data', this.dataHandler)
    }

    async destroy() {
        if (this.destroyed) {
            return
        }

        const peer = await this.peer
        if (peer) {
            peer.removeListener('data', this.dataHandler)
            await peer.destroy()
        }
        this.destroyed = true
    }

    async _sendPackage(
        syncPackage: FastSyncPackage,
        options: {
            interruptable: Interruptable
            packageIndex: number
            noChunking?: boolean
        },
    ) {
        this._debugLog('send package', syncPackage)
        if (this.destroyed) {
            throw new ChannelDestroyedError(
                'Cannot send package through destroyed channel',
            )
        }

        const sendAndConfirm = async (data: string) => {
            const peer = await this.waitForPeer()
            await options.interruptable.execute(async () => {
                peer.send(data)

                this._debugLog('waiting for confirmation')
                const response = await this._receivePackage({
                    ...options,
                    noChunking: true,
                    noConfirm: true,
                })
                this._debugLog('got confirmation', response)

                if (response.type !== 'confirm') {
                    console.error(`Invalid confirmation received:`, response)
                    throw new Error(`Invalid confirmation received`)
                }
            })
        }

        const serialized = JSON.stringify(syncPackage)
        if (options?.noChunking) {
            return sendAndConfirm(serialized)
        }

        await sendInChunks(serialized, sendAndConfirm, {
            interruptable: options.interruptable,
            chunkSize: 10000,
        })
        this._debugLog('sent package', syncPackage)
    }

    async _receivePackage(options: {
        interruptable: Interruptable
        packageIndex: number
        noChunking?: boolean
        noConfirm?: boolean
    }): Promise<FastSyncPackage> {
        this._debugLog(
            'receiving package',
            pick(options, 'noChunking', 'noConfirm'),
        )
        const { interruptable } = options

        if (this.destroyed) {
            throw new ChannelDestroyedError(
                'Cannot receive package from destroyed channel',
            )
        }

        const receive = async () => {
            const data = await this.dataReceived.promise
            this.dataReceived = resolvablePromise()
            return data
        }
        const maybeConfirm = async () => {
            this._debugLog('maybeConfirm start', !options?.noConfirm)
            if (!options?.noConfirm) {
                const confirmationPackage: FastSyncPackage<
                    UserPackageType,
                    false
                > = {
                    type: 'confirm',
                }
                const peer = await this.waitForPeer()
                peer.send(JSON.stringify(confirmationPackage))
            }
            this._debugLog('maybeConfirm end', !options?.noConfirm)
        }
        const receiveAndMaybeConfirm = async () => {
            const data = await interruptable.execute(receive)
            await interruptable.execute(maybeConfirm)
            return data as string
        }

        const serialized = options?.noChunking
            ? await receiveAndMaybeConfirm()
            : await receiveInChucks(receiveAndMaybeConfirm, interruptable)

        this._debugLog({ serialized })
        const syncPackage: FastSyncPackage = JSON.parse(
            serialized,
            jsonDateParser,
        )
        this._debugLog(
            'received package',
            pick(options, 'noChunking', 'noConfirm'),
        )
        return syncPackage
    }
}

interface MemoryFastSyncChannelPeer {
    sendPackage(syncPackage: FastSyncPackage): Promise<void>
    receivePackage(): Promise<FastSyncPackage>
}
interface MemoryFastSyncChannelDependencies {
    sender: MemoryFastSyncChannelPeer
    receiver: MemoryFastSyncChannelPeer
}
export class MemoryFastSyncChannel<
    UserPackageType = any
> extends FastSyncChannelBase<UserPackageType> {
    constructor(private dependencies: MemoryFastSyncChannelDependencies) {
        super()
    }

    async destroy() {}

    async _sendPackage(syncPackage: FastSyncPackage) {
        return this.dependencies.receiver.sendPackage(syncPackage)
    }

    async _receivePackage() {
        return this.dependencies.sender.receivePackage()
    }
}

function _createMemoryChannelPeer() {
    let sendPackagePromise = resolvablePromise<FastSyncPackage>()
    let receivePackagePromise = resolvablePromise()

    return {
        async sendPackage(syncPackage: FastSyncPackage) {
            // this._debugLog('sendPackage', syncPackage)
            sendPackagePromise.resolve(syncPackage)
            await receivePackagePromise.promise
        },
        async receivePackage(): Promise<FastSyncPackage> {
            const syncPackage = await sendPackagePromise.promise
            sendPackagePromise = resolvablePromise<FastSyncPackage>()
            receivePackagePromise.resolve(null)
            receivePackagePromise = resolvablePromise()
            return syncPackage
        },
    }
}

export function createMemoryChannel() {
    const peers: MemoryFastSyncChannelDependencies = {
        sender: _createMemoryChannelPeer(),
        receiver: _createMemoryChannelPeer(),
    }
    const senderChannel = new MemoryFastSyncChannel(peers)
    const receiverChannel = new MemoryFastSyncChannel({
        sender: peers.receiver,
        receiver: peers.sender,
    })

    return {
        senderChannel,
        receiverChannel,
    }
}
