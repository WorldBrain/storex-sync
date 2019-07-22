import * as SimplePeer from 'simple-peer'
import { FastSyncBatch, FastSyncSenderChannel, FastSyncReceiverChannel } from "./types";
import { resolvablePromise } from './utils';

type WebRTCSyncPackage =
    { type: 'batch', batch : any } |
    { type: 'confirm' } |
    { type: 'sync-info' } |
    { type: 'finish' }

export class WebRTCFastSyncReceiverChannel implements FastSyncReceiverChannel {
    constructor(private options : { peer : SimplePeer.Instance }) {
    }

    async* streamObjectBatches() : AsyncIterableIterator<{collection : string, objects : any[]}> {
        let dataReceived = resolvablePromise<string>()
        const dataHandler = (data : any) => {
            dataReceived.resolve(data.toString())
        }
        this.options.peer.on('data', dataHandler)

        try {
            while (true) {
                const data = await dataReceived.promise
                dataReceived = resolvablePromise()

                const syncPackage : WebRTCSyncPackage = JSON.parse(data)
                if (syncPackage.type === 'finish') {
                    break
                }

                if (syncPackage.type === 'batch') {
                    yield syncPackage.batch
                    this.options.peer.send(JSON.stringify({ type: 'confirmation' }))
                }
            }
        } finally {
            this.options.peer.removeListener('data', dataHandler)
        }
    }
}

export class WebRTCFastSyncSenderChannel implements FastSyncSenderChannel {
    constructor(private options : { peer : SimplePeer.Instance }) {
    }

    async sendSyncInfo() {
    }

    async sendObjectBatch (batch : FastSyncBatch) {
        const confirmationPromise = resolvablePromise<string>()
        this.options.peer.once('data', (data : any) => {
            confirmationPromise.resolve(data.toString())
        })
        const syncPackage : WebRTCSyncPackage = { type: 'batch', batch };
        this.options.peer.send(JSON.stringify(syncPackage))
        
        const response : WebRTCSyncPackage = JSON.parse(await confirmationPromise.promise)
        if (response.type !== 'confirm') {
            throw new Error(`Invalid confirmation received`)
        }
    }

    async finish() {
        this.options.peer.send(JSON.stringify({ type: 'confirm' }))
    }
}

export function createMemoryChannel() {
    // let transmitPromise! : ResolvablePromise<void>
    // let sendPromise = resolvablePromise<void>()

    // resolves when data has been sent, and replaced before yielding data to receivcer
    let sendBatchPromise = resolvablePromise<FastSyncBatch | null>()

    // resolves when data has been received, and replaced right after
    let recvBatchPromise = resolvablePromise<void>()

    const senderChannel : FastSyncSenderChannel = {
        sendSyncInfo: async () => {
            // transmitPromise = resolvablePromise()
            // sendPromise.resolve()
            // await transmitPromise.promise
            // sendPromise = resolvablePromise<void>()
        },
        sendObjectBatch: async (batch : FastSyncBatch) => {
            sendBatchPromise.resolve(batch)
            await recvBatchPromise.promise
        },
        finish: async () => {
            // console.log('senderChannel.finish()')
            sendBatchPromise.resolve(null)
        }
    }
    const receiverChannel : FastSyncReceiverChannel = {
        streamObjectBatches: async function* () : AsyncIterableIterator<{collection : string, objects : any[]}> {
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
        }
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