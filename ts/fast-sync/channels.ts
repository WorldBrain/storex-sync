import { EventEmitter } from 'events'
import TypedEmitter from 'typed-emitter'
import { jsonDateParser } from 'json-date-parser'
import * as SimplePeer from 'simple-peer'
import {
    FastSyncBatch,
    FastSyncInfo,
    SyncPackage,
    FastSyncChannelEvents,
    FastSyncChannel,
} from './types'
import { ResolvablePromise, resolvablePromise } from './utils'

abstract class FastSyncChannelBase<UserPackageType> implements FastSyncChannel {
    events = new EventEmitter() as TypedEmitter<FastSyncChannelEvents>

    timeoutInMiliseconds = 10 * 1000
    preSend?: (syncPackage: SyncPackage) => Promise<void>
    postReceive?: (syncPackage: SyncPackage) => Promise<void>

    abstract _sendPackage(syncPackage: SyncPackage): Promise<void>
    abstract _receivePackage(): Promise<SyncPackage>

    abstract destroy(): Promise<void>

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
        const syncPackage = await this._withStallingDetection(() =>
            this._receivePackage(),
        )

        if (this.postReceive) {
            await this.postReceive(syncPackage)
        }

        return syncPackage
    }

    async _sendPackageSafely(syncPackage: SyncPackage) {
        if (this.preSend) {
            await this.preSend(syncPackage)
        }

        await this._withStallingDetection(() => this._sendPackage(syncPackage))
    }

    async _withStallingDetection<T>(f: () => Promise<T>) {
        const stalledTimeout = setTimeout(() => {
            this.events.emit('stalled')
        }, this.timeoutInMiliseconds)
        const toReturn = await f()
        clearTimeout(stalledTimeout)
        return toReturn
    }
}

export class WebRTCFastSyncChannel<UserPackageType> extends FastSyncChannelBase<
    UserPackageType
> {
    dataReceived = resolvablePromise<string>()
    dataHandler: (data: any) => void

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
        this.options.peer.removeListener('data', this.dataHandler)
        await this.options.peer.destroy()
    }

    async _sendPackage(syncPackage: SyncPackage) {
        this.options.peer.send(JSON.stringify(syncPackage))

        const response = await this._receivePackage(false)

        if (response.type !== 'confirm') {
            console.error(`Invalid confirmation received:`, response)
            throw new Error(`Invalid confirmation received`)
        }
    }

    async _receivePackage(confirm = true): Promise<SyncPackage> {
        const data = await this.dataReceived.promise
        this.dataReceived = resolvablePromise()

        const syncPackage: SyncPackage = JSON.parse(data, jsonDateParser)

        if (confirm) {
            const confirmationPackage: SyncPackage = {
                type: 'confirm',
            }
            this.options.peer.send(JSON.stringify(confirmationPackage))
        }

        return syncPackage
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
export class MemoryFastSyncChannel<
    UserPackageType = any
> extends FastSyncChannelBase<UserPackageType> {
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
