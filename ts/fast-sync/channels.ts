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
} from './chunking'

export class ChannelDestroyedError extends Error {
    name = 'ChannelDestroyedError'
}

abstract class FastSyncChannelBase<UserPackageType> implements FastSyncChannel {
    events = new EventEmitter() as TypedEmitter<FastSyncChannelEvents>

    packageTimeoutInMilliseconds = 10 * 1000
    channelTimeoutInMilliseconds = 180 * 1000
    preSend?: (syncPackage: FastSyncPackage) => Promise<void>
    postReceive?: (syncPackage: FastSyncPackage) => Promise<void>
    channelTimeout?: NodeJS.Timer

    abstract _sendPackage(syncPackage: FastSyncPackage): Promise<void>
    abstract _receivePackage(): Promise<FastSyncPackage>

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
                options &&
                options.expectedType &&
                innerPackage.type !== options.expectedType
            ) {
                throw new Error(
                    `Expected user package with type ${String(
                        options.expectedType,
                    )} ` +
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
        this._clearChannelTimeout()
        await this._sendPackageSafely({ type: 'finish' })
    }

    async _receivePackageSafely() {
        const syncPackage = await this._withPackageStallingDetection(() =>
            this._receivePackage(),
        )
        this._refreshChannelTimeout()

        if (this.postReceive) {
            await this.postReceive(syncPackage)
        }

        return syncPackage
    }

    async _sendPackageSafely(syncPackage: FastSyncPackage) {
        if (this.preSend) {
            await this.preSend(syncPackage)
        }
        await this._withPackageStallingDetection(() =>
            this._sendPackage(syncPackage),
        )
        this._refreshChannelTimeout()
    }

    async _withPackageStallingDetection<T>(f: () => Promise<T>) {
        const stalledTimeout = setTimeout(() => {
            this.events.emit('packageStalled')
        }, this.packageTimeoutInMilliseconds)
        const toReturn = await f()
        clearTimeout(stalledTimeout)
        return toReturn
    }

    _refreshChannelTimeout() {
        this._clearChannelTimeout()
        this.channelTimeout = setTimeout(() => {
            this.events.emit('channelTimeout')
        }, this.channelTimeoutInMilliseconds) as any
    }

    _clearChannelTimeout() {
        if (this.channelTimeout) {
            clearTimeout(this.channelTimeout)
        }
    }
}

export class WebRTCFastSyncChannel<UserPackageType> extends FastSyncChannelBase<
    UserPackageType
> {
    dataReceived = resolvablePromise<string>()
    dataHandler: (data: any) => void

    private destroyed = false

    constructor(private options: { peer: SimplePeer.Instance }) {
        super()

        this.dataHandler = (data: any) => {
            // This promise gets replaced after each received package
            // NOTE: This assumes package are sent and confirmed one by one
            this.dataReceived.resolve(data.toString())
        }
        this.options.peer.on('data', this.dataHandler)
    }

    async destroy() {
        if (this.destroyed) {
            return
        }

        this.options.peer.removeListener('data', this.dataHandler)
        await this.options.peer.destroy()
        this.destroyed = true
    }

    async _sendPackage(
        syncPackage: FastSyncPackage,
        options?: { noChunking?: boolean },
    ) {
        if (this.destroyed) {
            throw new ChannelDestroyedError(
                'Cannot send package through destroyed channel',
            )
        }

        const sendAndConfirm = async (data: string) => {
            this.options.peer.send(data)

            const response = await this._receivePackage({
                noChunking: true,
                noConfirm: true,
            })

            if (response.type !== 'confirm') {
                console.error(`Invalid confirmation received:`, response)
                throw new Error(`Invalid confirmation received`)
            }
        }

        const serialized = JSON.stringify(syncPackage)
        if (options?.noChunking) {
            return sendAndConfirm(serialized)
        }

        const chunkSize = 10000
        const chunkCount = calculateStringChunkCount(serialized, { chunkSize })
        for (let chunkIndex = 0; chunkIndex < chunkCount; ++chunkIndex) {
            const chunkContent = getStringChunk(serialized, chunkIndex, {
                chunkSize,
            })
            await sendAndConfirm(
                `chunk:${chunkIndex}:${chunkCount}:${chunkContent}`,
            )
        }
    }

    async _receivePackage(options?: {
        noChunking?: boolean
        noConfirm?: boolean
    }): Promise<FastSyncPackage> {
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
            if (!options?.noConfirm) {
                const confirmationPackage: FastSyncPackage = {
                    type: 'confirm',
                }
                this.options.peer.send(JSON.stringify(confirmationPackage))
            }
        }
        const receiveAndMaybeConfirm = async () => {
            const data = await receive()
            await maybeConfirm()
            return data
        }

        const serialized = options?.noChunking
            ? await receiveAndMaybeConfirm()
            : await receiveInChucks(receiveAndMaybeConfirm)

        const syncPackage: FastSyncPackage = JSON.parse(
            serialized,
            jsonDateParser,
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
            // console.log('sendPackage', syncPackage)
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
