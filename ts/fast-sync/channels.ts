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
            throw new Error(`Received package with unexpected type while waiting for initial Sync info: ${syncPackage.type}`)
        }
        return syncPackage.info
    }

    async _receivePackage() : Promise<WebRTCSyncPackage> {
        const data = await this.dataReceived.promise
        this.dataReceived = resolvablePromise()

        const syncPackage: WebRTCSyncPackage = JSON.parse(data)

        const confirmationPackage: WebRTCSyncPackage = {
            type: 'confirm',
        }
        this.options.peer.send(JSON.stringify(confirmationPackage))

        return syncPackage
    }
}

export class WebRTCFastSyncSenderChannel implements FastSyncSenderChannel {
    constructor(private options: { peer: SimplePeer.Instance }) {}

    async sendSyncInfo(info: FastSyncInfo) {
        const syncPackage: WebRTCSyncPackage = { type: 'sync-info', info }
        await this._sendPackage(syncPackage)
    }

    async sendObjectBatch(batch: FastSyncBatch) {
        const syncPackage: WebRTCSyncPackage = { type: 'batch', batch }
        await this._sendPackage(syncPackage)
    }

    async finish() {
        const syncPackage: WebRTCSyncPackage = { type: 'finish' }
        await this._sendPackage(syncPackage)
    }

    async _sendPackage(syncPackage : WebRTCSyncPackage) {
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
    let recvBatchPromise = resolvablePromise<void>()

    let sendSyncInfoPromise = resolvablePromise<FastSyncInfo>()
    let recvSyncInfoPromise = resolvablePromise<void>()

    const senderChannel: FastSyncSenderChannel = {
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
    }
    const receiverChannel: FastSyncReceiverChannel = {
        streamObjectBatches: async function*(): AsyncIterableIterator<{
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
                recvBatchPromise.resolve()
                recvBatchPromise = resolvablePromise<void>()
                // console.log('stream: end iter')
            }
            // console.log('stream: end')
        },
        receiveSyncInfo: async function() {
            const info = await sendSyncInfoPromise.promise
            sendSyncInfoPromise = resolvablePromise<FastSyncInfo>()
            recvSyncInfoPromise.resolve()
            recvSyncInfoPromise = resolvablePromise<void>()
            return info
        },
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
