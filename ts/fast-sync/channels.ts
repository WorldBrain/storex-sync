import { jsonDateParser } from 'json-date-parser'
import * as SimplePeer from 'simple-peer'
import {
    FastSyncBatch,
    FastSyncSenderChannel,
    FastSyncReceiverChannel,
    FastSyncInfo,
} from './types'
import { ResolvablePromise, resolvablePromise } from './utils'

type WebRTCSyncPackage =
    | { type: 'batch'; batch: any }
    | { type: 'confirm' }
    | { type: 'sync-info'; info: FastSyncInfo }
    | { type: 'finish' }
    | { type: 'user-package' }

export class WebRTCFastSyncReceiverChannel implements FastSyncReceiverChannel {
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

    async receiveUserPackage(): Promise<any> {

    }

    async *streamObjectBatches(): AsyncIterableIterator<{
        collection: string
        objects: any[]
    }> {
        try {
            while (true) {
                const syncPackage: WebRTCSyncPackage = await this._receivePackage()
                if (syncPackage.type === 'finish') {
                    // console.log('received finish package')
                    break
                }

                if (syncPackage.type === 'batch') {
                    yield syncPackage.batch
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
    constructor(private options: { peer: SimplePeer.Instance }) { }

    async sendUserPackage(jsonSerializable: any): Promise<void> {

    }

    async sendSyncInfo(info: FastSyncInfo) {
        await this._sendPackage({ type: 'sync-info', info })
    }

    async sendObjectBatch(batch: FastSyncBatch) {
        await this._sendPackage({ type: 'batch', batch })
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
    // let transmitPromise! : ResolvablePromise<void>
    // let sendPromise = resolvablePromise<void>()

    // resolves when data has been sent, and replaced before yielding data to receivcer
    let sendBatchPromise = resolvablePromise<FastSyncBatch | null>()

    // resolves when data has been received, and replaced right after
    let recvBatchPromise = resolvablePromise()

    let sendSyncInfoPromise = resolvablePromise<FastSyncInfo>()
    let recvSyncInfoPromise = resolvablePromise()

    const senderChannel: FastSyncSenderChannel = {
        async sendUserPackage(jsonSerializable: any): Promise<void> {

        },
        sendSyncInfo: async (syncInfo: FastSyncInfo) => {
            // transmitPromise = resolvablePromise()
            // sendPromise.resolve()
            // await transmitPromise.promise
            // sendPromise = resolvablePromise<void>()
            sendSyncInfoPromise.resolve(syncInfo)
            await recvSyncInfoPromise.promise
        },
        sendObjectBatch: async (batch: FastSyncBatch) => {
            sendBatchPromise.resolve(batch)
            await recvBatchPromise.promise
        },
        finish: async () => {
            // console.log('senderChannel.finish()')
            sendBatchPromise.resolve(null)
        },
        destroy: async () => { },
    }
    const receiverChannel: FastSyncReceiverChannel = {
        async receiveUserPackage(): Promise<any> {

        },
        streamObjectBatches: async function* (): AsyncIterableIterator<{
            collection: string
            objects: any[]
        }> {
            // console.log('stream: start')
            while (true) {
                // console.log('stream: start iter')
                const batch = await sendBatchPromise.promise
                if (!batch) {
                    break
                }
                sendBatchPromise = resolvablePromise<FastSyncBatch | null>()
                yield batch
                recvBatchPromise.resolve(null)
                recvBatchPromise = resolvablePromise()
                // console.log('stream: end iter')
            }
            // console.log('stream: end')
        },
        receiveSyncInfo: async function () {
            const info = await sendSyncInfoPromise.promise
            sendSyncInfoPromise = resolvablePromise<FastSyncInfo>()
            recvSyncInfoPromise.resolve(null)
            recvSyncInfoPromise = resolvablePromise()
            return info
        },
        destroy: async () => { },
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
