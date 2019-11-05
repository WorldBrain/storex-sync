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
} from './types'
import { ResolvablePromise, resolvablePromise } from './utils'

type SyncPackage<UserPackageType = any> =
    | { type: 'batch'; batch: any }
    | { type: 'confirm' }
    | { type: 'state-change'; state: 'paused' | 'running' }
    | { type: 'sync-info'; info: FastSyncInfo }
    | { type: 'finish' }
    | { type: 'user-package'; package: UserPackageType }

abstract class FastSyncReceiverChannelBase<UserPackageType>
    implements FastSyncReceiverChannel {
    events = new EventEmitter() as TypedEmitter<FastSyncReceiverChannelEvents>

    abstract destroy(): Promise<void>
    protected abstract _receivePackage(): Promise<SyncPackage>
    protected abstract _cleanup(): Promise<void>

    async receiveUserPackage(): Promise<UserPackageType> {
        const userPackage = await this._receivePackage()
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
        try {
            while (true) {
                const syncPackage: SyncPackage = await this._receivePackage()
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
        } finally {
            await this._cleanup()
        }
    }

    async receiveSyncInfo() {
        const syncPackage: SyncPackage = await this._receivePackage()
        if (syncPackage.type !== 'sync-info') {
            throw new Error(
                `Received package with unexpected type while waiting for initial Sync info: ${syncPackage.type}`,
            )
        }
        return syncPackage.info
    }
}

abstract class FastSyncSenderChannelBase implements FastSyncSenderChannel {
    abstract destroy(): Promise<void>
    protected abstract _sendPackage(syncPackage: SyncPackage): Promise<void>

    async sendUserPackage(jsonSerializable: any): Promise<void> {
        await this._sendPackage({
            type: 'user-package',
            package: jsonSerializable,
        })
    }

    async sendSyncInfo(info: FastSyncInfo) {
        await this._sendPackage({ type: 'sync-info', info })
    }

    async sendObjectBatch(batch: FastSyncBatch) {
        await this._sendPackage({ type: 'batch', batch })
    }

    async sendStateChange(state: 'paused' | 'running'): Promise<void> {
        await this._sendPackage({ type: 'state-change', state })
    }

    async finish() {
        await this._sendPackage({ type: 'finish' })
    }
}

export class WebRTCFastSyncReceiverChannel<
    UserPackageType
> extends FastSyncReceiverChannelBase<UserPackageType> {
    private dataReceived = resolvablePromise<string>()
    private dataHandler: (data: any) => void

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
        await this.options.peer.destroy()
    }

    async _cleanup() {
        this.options.peer.removeListener('data', this.dataHandler)
    }

    async _receivePackage(): Promise<SyncPackage> {
        const data = await this.dataReceived.promise
        this.dataReceived = resolvablePromise()

        const syncPackage: SyncPackage = JSON.parse(data, jsonDateParser)

        const confirmationPackage: SyncPackage = {
            type: 'confirm',
        }
        this.options.peer.send(JSON.stringify(confirmationPackage))

        return syncPackage
    }
}

export class WebRTCFastSyncSenderChannel extends FastSyncSenderChannelBase {
    constructor(private options: { peer: SimplePeer.Instance }) {
        super()
    }

    async destroy() {
        await this.options.peer.destroy()
    }

    async _sendPackage(syncPackage: SyncPackage) {
        const confirmationPromise = resolvablePromise<string>()
        this.options.peer.once('data', (data: any) => {
            confirmationPromise.resolve(data.toString())
        })
        this.options.peer.send(JSON.stringify(syncPackage))

        const response: SyncPackage = JSON.parse(
            await confirmationPromise.promise,
        )
        if (response.type !== 'confirm') {
            console.error(`Invalid confirmation received:`, response)
            throw new Error(`Invalid confirmation received`)
        }
    }
}

interface MemoryFastSyncChannelDependencies {
    sendPackage(syncPackage: SyncPackage): Promise<void>
    receivePackage(): Promise<SyncPackage>
}
class MemoryFastSyncReceiverChannel<
    UserPackageType = any
> extends FastSyncReceiverChannelBase<UserPackageType> {
    constructor(private dependencies: MemoryFastSyncChannelDependencies) {
        super()
    }

    async destroy() {}

    _receivePackage() {
        return this.dependencies.receivePackage()
    }

    async _cleanup() {}
}

class MemoryFastSyncSenderChannel extends FastSyncSenderChannelBase {
    constructor(private dependencies: MemoryFastSyncChannelDependencies) {
        super()
    }

    async destroy() {}

    _sendPackage(syncPackage: SyncPackage) {
        return this.dependencies.sendPackage(syncPackage)
    }

    async _cleanup() {}
}

export function createMemoryChannel() {
    let sendPackagePromise = resolvablePromise<SyncPackage>()
    let receivePackagePromise = resolvablePromise()

    const shared = {
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

    const senderChannel = new MemoryFastSyncSenderChannel(shared)
    const receiverChannel = new MemoryFastSyncReceiverChannel(shared)

    return {
        senderChannel,
        receiverChannel,
    }
}
