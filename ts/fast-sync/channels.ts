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

type WebRTCSyncPackage<UserPackageType = any> =
    | { type: 'batch'; batch: any }
    | { type: 'confirm' }
    | { type: 'state-change'; state: 'paused' | 'running' }
    | { type: 'sync-info'; info: FastSyncInfo }
    | { type: 'finish' }
    | { type: 'user-package'; package: UserPackageType }

export class WebRTCFastSyncReceiverChannel<UserPackageType>
    implements FastSyncReceiverChannel {
    public events = new EventEmitter() as TypedEmitter<
        FastSyncReceiverChannelEvents
    >
    private dataReceived = resolvablePromise<string>()
    private dataHandler: (data: any) => void

    constructor(private options: { peer: SimplePeer.Instance }) {
        this.dataHandler = (data: any) => {
            // This promise gets replaced after each received package
            // NOTE: This assumes package are sent and confirmed one by one
            this.dataReceived.resolve(data.toString())
        }
        this.options.peer.on('data', this.dataHandler)
    }

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
                const syncPackage: WebRTCSyncPackage = await this._receivePackage()
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
            this.options.peer.removeListener('data', this.dataHandler)
        }
    }

    async receiveSyncInfo() {
        const syncPackage: WebRTCSyncPackage = await this._receivePackage()
        if (syncPackage.type !== 'sync-info') {
            throw new Error(
                `Received package with unexpected type while waiting for initial Sync info: ${syncPackage.type}`,
            )
        }
        return syncPackage.info
    }

    async destroy() {
        await this.options.peer.destroy()
    }

    async _receivePackage(): Promise<WebRTCSyncPackage> {
        const data = await this.dataReceived.promise
        this.dataReceived = resolvablePromise()

        const syncPackage: WebRTCSyncPackage = JSON.parse(data, jsonDateParser)

        const confirmationPackage: WebRTCSyncPackage = {
            type: 'confirm',
        }
        this.options.peer.send(JSON.stringify(confirmationPackage))

        return syncPackage
    }
}

export class WebRTCFastSyncSenderChannel implements FastSyncSenderChannel {
    constructor(private options: { peer: SimplePeer.Instance }) {}

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

    async destroy() {
        await this.options.peer.destroy()
    }

    async _sendPackage(syncPackage: WebRTCSyncPackage) {
        const confirmationPromise = resolvablePromise<string>()
        this.options.peer.once('data', (data: any) => {
            confirmationPromise.resolve(data.toString())
        })
        this.options.peer.send(JSON.stringify(syncPackage))

        const response: WebRTCSyncPackage = JSON.parse(
            await confirmationPromise.promise,
        )
        if (response.type !== 'confirm') {
            console.error(`Invalid confirmation received:`, response)
            throw new Error(`Invalid confirmation received`)
        }
    }
}

export function createMemoryChannel() {
    let sendPackagePromise = resolvablePromise<WebRTCSyncPackage>()
    let receivePackagePromise = resolvablePromise()

    const sendPackage = async (syncPackage: WebRTCSyncPackage) => {
        // console.log('sendPackage', syncPackage)
        sendPackagePromise.resolve(syncPackage)
        await receivePackagePromise.promise
    }
    const receivePackage = async (): Promise<WebRTCSyncPackage> => {
        const syncPackage = await sendPackagePromise.promise
        sendPackagePromise = resolvablePromise<WebRTCSyncPackage>()
        receivePackagePromise.resolve(null)
        receivePackagePromise = resolvablePromise()
        return syncPackage
    }
    const events = new EventEmitter() as TypedEmitter<
        FastSyncReceiverChannelEvents
    >

    const senderChannel: FastSyncSenderChannel = {
        async sendUserPackage(jsonSerializable: any): Promise<void> {
            await sendPackage({
                type: 'user-package',
                package: jsonSerializable,
            })
        },
        async sendSyncInfo(info: FastSyncInfo) {
            await sendPackage({ type: 'sync-info', info })
        },
        async sendObjectBatch(batch: FastSyncBatch) {
            await sendPackage({ type: 'batch', batch })
        },
        async sendStateChange(state: 'paused' | 'running'): Promise<void> {
            await sendPackage({ type: 'state-change', state })
        },
        finish: async () => {
            // console.log('senderChannel.finish()')
            await sendPackage({ type: 'finish' })
        },
        destroy: async () => {},
    }
    const receiverChannel: FastSyncReceiverChannel = {
        events,
        async receiveUserPackage(): Promise<any> {
            const userPackage = await receivePackage()
            if (userPackage.type === 'user-package') {
                return userPackage.package
            } else {
                throw new Error(
                    `Expected user package in fast sync in-memory channel, but got package type ${userPackage.type}`,
                )
            }
        },
        streamObjectBatches: async function*(): AsyncIterableIterator<{
            collection: string
            objects: any[]
        }> {
            // console.log('stream: start')
            while (true) {
                // console.log('stream: start iter')
                const syncPackage = await receivePackage()
                if (syncPackage.type === 'finish') {
                    break
                }
                if (syncPackage.type === 'state-change') {
                    events.emit(
                        syncPackage.state === 'running' ? 'resumed' : 'paused',
                    )
                    continue
                }
                if (syncPackage.type !== 'batch') {
                    throw new Error(
                        `Expected batch package in fast sync in-memory channel, but got package type ${syncPackage.type}`,
                    )
                }
                yield syncPackage.batch
                // console.log('stream: end iter')
            }
            // console.log('stream: end')
        },
        receiveSyncInfo: async function() {
            const syncPackage = await receivePackage()
            if (syncPackage.type !== 'sync-info') {
                throw new Error(
                    `Expected sync info package in fast sync in-memory channel, but got package type ${syncPackage.type}`,
                )
            }
            return syncPackage.info
        },
        destroy: async () => {},
    }

    return {
        senderChannel,
        receiverChannel,
        // transmit: () => {
        //     transmitPromise.resolve()
        // },
        // waitForSend: async () => {

        // }
    }
}
