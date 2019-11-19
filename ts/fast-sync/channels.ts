import { EventEmitter } from 'events'
import TypedEmitter from 'typed-emitter'
import { jsonDateParser } from 'json-date-parser'
import * as SimplePeer from 'simple-peer'
import {
    FastSyncBatch,
    FastSyncSenderChannel,
    FastSyncReceiverChannel,
    FastSyncInfo,
    FastSyncReceiverChannelEvents,
    FastSyncSenderChannelEvents,
    SyncPackage,
    FastSyncChannelEvents,
} from './types'
import { ResolvablePromise, resolvablePromise } from './utils'

abstract class FastSyncChannel<UserPackageType> {
    timeoutInMiliseconds = 10 * 1000
    preSend?: (syncPackage: SyncPackage) => Promise<void>
    postReceive?: (syncPackage: SyncPackage) => Promise<void>

    abstract events:
        | TypedEmitter<FastSyncSenderChannelEvents>
        | TypedEmitter<FastSyncReceiverChannelEvents>
    protected abstract _sendPackage(syncPackage: SyncPackage): Promise<void>
    protected abstract _receivePackage(): Promise<SyncPackage>

    async sendUserPackage(jsonSerializable: any): Promise<void> {
        await this._sendPackageSafely({
            type: 'user-package',
            package: jsonSerializable,
        })
    }

    async receiveUserPackage(): Promise<UserPackageType> {
        const userPackage = await this._receivePackageSafely()
        if (userPackage.type === 'user-package') {
            return userPackage.package
        } else {
            throw new Error(
                `Expected user package in fast sync WebRTC channel, but got package type ${userPackage.type}`,
            )
        }
    }

    protected async _receivePackageSafely() {
        const stalledTimeout = setTimeout(() => {
            ;(this.events as TypedEmitter<FastSyncChannelEvents>).emit(
                'stalled',
            )
        }, this.timeoutInMiliseconds)

        const syncPackage = await this._receivePackage()
        clearTimeout(stalledTimeout)

        if (this.postReceive) {
            await this.postReceive(syncPackage)
        }

        return syncPackage
    }

    protected async _sendPackageSafely(syncPackage: SyncPackage) {
        if (this.preSend) {
            await this.preSend(syncPackage)
        }

        const stalledTimeout = setTimeout(() => {
            ;(this.events as TypedEmitter<FastSyncChannelEvents>).emit(
                'stalled',
            )
        }, this.timeoutInMiliseconds)
        await this._sendPackage(syncPackage)
        clearTimeout(stalledTimeout)
    }
}

abstract class FastSyncReceiverChannelBase<UserPackageType = any>
    extends FastSyncChannel<UserPackageType>
    implements FastSyncReceiverChannel {
    timeoutInMiliseconds = 10 * 1000
    postReceive?: (syncPackage: SyncPackage) => Promise<void>

    events = new EventEmitter() as TypedEmitter<FastSyncReceiverChannelEvents>

    abstract destroy(): Promise<void>

    async *streamObjectBatches(): AsyncIterableIterator<{
        collection: string
        objects: any[]
    }> {
        while (true) {
            const syncPackage: SyncPackage = await this._receivePackageSafely()
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
        const syncPackage: SyncPackage = await this._receivePackageSafely()
        if (syncPackage.type !== 'sync-info') {
            throw new Error(
                `Received package with unexpected type while waiting for initial Sync info: ${syncPackage.type}`,
            )
        }
        return syncPackage.info
    }
}

abstract class FastSyncSenderChannelBase<UserPackageType = any>
    extends FastSyncChannel<UserPackageType>
    implements FastSyncSenderChannel {
    timeoutInMiliseconds = 10 * 1000
    events = new EventEmitter() as TypedEmitter<FastSyncSenderChannelEvents>

    abstract destroy(): Promise<void>
    protected abstract _sendPackage(syncPackage: SyncPackage): Promise<void>
    protected abstract _receivePackage(): Promise<SyncPackage>

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
}

export class WebRTCFastSyncReceiverChannel<
    UserPackageType
> extends FastSyncReceiverChannelBase<UserPackageType> {
    private mixin: ReturnType<typeof _createWebRTCMixin>

    constructor(private options: { peer: SimplePeer.Instance }) {
        super()

        this.mixin = _createWebRTCMixin(options)
    }

    _sendPackage = (syncPackage: SyncPackage) =>
        this.mixin._sendPackage(syncPackage)
    _receivePackage = () => this.mixin._receivePackage()
    destroy = () => this.mixin.destroy()
}

export class WebRTCFastSyncSenderChannel<
    UserPackageType
> extends FastSyncSenderChannelBase<UserPackageType> {
    private mixin: ReturnType<typeof _createWebRTCMixin>

    constructor(options: { peer: SimplePeer.Instance }) {
        super()

        this.mixin = _createWebRTCMixin(options)
    }

    _sendPackage = (syncPackage: SyncPackage) =>
        this.mixin._sendPackage(syncPackage)
    _receivePackage = () => this.mixin._receivePackage()
    destroy = () => this.mixin.destroy()
}

function _createWebRTCMixin(options: { peer: SimplePeer.Instance }) {
    let dataReceived = resolvablePromise<string>()
    const dataHandler = (data: any) => {
        // This promise gets replaced after each received package
        // NOTE: This assumes package are sent and confirmed one by one
        dataReceived.resolve(data.toString())
    }
    options.peer.on('data', dataHandler)

    return {
        async destroy() {
            options.peer.removeListener('data', dataHandler)
            await options.peer.destroy()
        },
        async _sendPackage(syncPackage: SyncPackage) {
            options.peer.send(JSON.stringify(syncPackage))

            const response = await this._receivePackage(false)

            if (response.type !== 'confirm') {
                console.error(`Invalid confirmation received:`, response)
                throw new Error(`Invalid confirmation received`)
            }
        },
        async _receivePackage(confirm = true): Promise<SyncPackage> {
            const data = await dataReceived.promise
            dataReceived = resolvablePromise()

            const syncPackage: SyncPackage = JSON.parse(data, jsonDateParser)

            if (confirm) {
                const confirmationPackage: SyncPackage = {
                    type: 'confirm',
                }
                options.peer.send(JSON.stringify(confirmationPackage))
            }

            return syncPackage
        },
    }
}

interface MemoryFastSyncChannelPeer {
    sendPackage(syncPackage: SyncPackage): Promise<void>
    receivePackage(): Promise<SyncPackage>
}
interface MemoryFastSyncChannelDependencies {
    sender: MemoryFastSyncChannelPeer
    receiver: MemoryFastSyncChannelPeer
}
export class MemoryFastSyncReceiverChannel<
    UserPackageType = any
> extends FastSyncReceiverChannelBase<UserPackageType> {
    constructor(private dependencies: MemoryFastSyncChannelDependencies) {
        super()
    }

    async destroy() {}

    async _sendPackage(syncPackage: SyncPackage) {
        return this.dependencies.receiver.sendPackage(syncPackage)
    }

    async _receivePackage() {
        return this.dependencies.sender.receivePackage()
    }
}

export class MemoryFastSyncSenderChannel extends FastSyncSenderChannelBase {
    constructor(private dependencies: MemoryFastSyncChannelDependencies) {
        super()
    }

    async destroy() {}

    async _sendPackage(syncPackage: SyncPackage) {
        return this.dependencies.sender.sendPackage(syncPackage)
    }

    async _receivePackage() {
        return this.dependencies.receiver.receivePackage()
    }
}

function _createMemoryChannelPeer() {
    let sendPackagePromise = resolvablePromise<SyncPackage>()
    let receivePackagePromise = resolvablePromise()

    return {
        async sendPackage(syncPackage: SyncPackage) {
            // console.log('sendPackage', syncPackage)
            sendPackagePromise.resolve(syncPackage)
            await receivePackagePromise.promise
        },
        async receivePackage(): Promise<SyncPackage> {
            const syncPackage = await sendPackagePromise.promise
            sendPackagePromise = resolvablePromise<SyncPackage>()
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
    const senderChannel = new MemoryFastSyncSenderChannel(peers)
    const receiverChannel = new MemoryFastSyncReceiverChannel(peers)

    return {
        senderChannel,
        receiverChannel,
    }
}
