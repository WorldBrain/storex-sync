import { EventEmitter } from "events";
import TypedEmitter from 'typed-emitter';
import StorageManager from "@worldbrain/storex";
import { FastSyncReceiverChannel, FastSyncSenderChannel, FastSyncInfo } from "./types";

export interface FastSyncSenderOptions {
    storageManager : StorageManager
    channel : FastSyncSenderChannel
    collections : string[]
}

export class FastSyncSender {
    public events : TypedEmitter<{
        prepared : (event : { syncInfo: FastSyncInfo }) => void
    }> = new EventEmitter() as any
    
    constructor(private options : FastSyncSenderOptions) {

    }
    
    async execute() {
        const { channel } = this.options

        const syncInfo = await getSyncInfo(this.options.storageManager)
        this.events.emit('prepared', { syncInfo })
        await channel.sendSyncInfo(syncInfo)

        for (const collection of this.options.collections) {
            for await (const objects of streamObjectBatches(this.options.storageManager, collection)) {
                await channel.sendObjectBatch({ collection, objects })
            }
        }
        await channel.finish()
    }
}

export class FastSyncReceiver {
    public events : TypedEmitter<{}> = new EventEmitter() as any

    constructor(private options : { storageManager : StorageManager, channel : FastSyncReceiverChannel }) {

    }

    async execute() {
        // console.log('recv: entering loop')
        for await (const objectBatch of this.options.channel.streamObjectBatches()) {
            // console.log('recv: start iter')
            for (const object of objectBatch.objects) {
                await this.options.storageManager.collection(objectBatch.collection).createObject(object)
            }
            // console.log('recv: end iter')
        }
    }
}

async function getSyncInfo(storageManager : StorageManager) : Promise<FastSyncInfo> {
    let collectionCount = 0
    let objectCount = 0
    for (const [collectionName, collectionDefinition] of Object.entries(storageManager.registry.collections)) {
        collectionCount += 1
        objectCount += await storageManager.collection(collectionName).countObjects({})
    }
    return { collectionCount, objectCount }
}

async function* streamObjectBatches(storageManager : StorageManager, collection : string) : AsyncIterableIterator<any[]> {
    // const pkIndex = storageManager.registry.collections[collection]
    // if (typeof pkIndex !== 'string') {
    //     throw new Error(`Only simple PK indices are supported for now (colllection: ${collection})`)
    // }

    for (const object of await storageManager.collection(collection).findObjects({})) {
        yield [object]
    }
}