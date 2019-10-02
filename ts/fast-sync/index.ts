import { EventEmitter } from 'events'
import TypedEmitter from 'typed-emitter'
import StorageManager from '@worldbrain/storex'
import {
    FastSyncReceiverChannel,
    FastSyncSenderChannel,
    FastSyncInfo,
    FastSyncProgress,
} from './types'

export interface FastSyncSenderOptions {
    storageManager: StorageManager
    channel: FastSyncSenderChannel
    collections: string[]
    preSendProcessor?: FastSyncPreSendProcessor
}

export type FastSyncPreSendProcessor = (
    params: FastSyncPreSendProcessorParams,
) => Promise<{ object: any | null }>
export interface FastSyncPreSendProcessorParams {
    collection: string
    object: any
}

export interface FastSyncEvents {
    prepared: (event: { syncInfo: FastSyncInfo }) => void
    progress: (event: { progress: FastSyncProgress }) => void
}

export class FastSyncSender {
    public events: TypedEmitter<
        FastSyncEvents
    > = new EventEmitter() as TypedEmitter<FastSyncEvents>
    private totalObjectsProcessed: number

    constructor(private options: FastSyncSenderOptions) {
        this.totalObjectsProcessed = 0
    }

    async execute() {
        const { channel } = this.options
        const preproccesObjects = async (params: {
            collection: string
            objects: any[]
        }) => {
            const preSendProcessor = this.options.preSendProcessor
            if (!preSendProcessor) {
                return params.objects
            }

            const processedObjects = (await Promise.all(
                params.objects.map(
                    async object =>
                        (await preSendProcessor({
                            collection: params.collection,
                            object,
                        })).object,
                ),
            )).filter(object => !!object)
            return processedObjects
        }

        const syncInfo = await getSyncInfo(this.options.storageManager)
        this.events.emit('prepared', { syncInfo })
        await channel.sendSyncInfo(syncInfo)

        this.events.emit('progress', {
            progress: {
                ...syncInfo,
                totalObjectsProcessed: this.totalObjectsProcessed,
            },
        })
        // console.log('sending batches')
        for (const collection of this.options.collections) {
            for await (const objects of streamObjectBatches(
                this.options.storageManager,
                collection,
            )) {
                const processedObjects = await preproccesObjects({
                    collection,
                    objects,
                })
                if (processedObjects.length) {
                    await channel.sendObjectBatch({
                        collection,
                        objects: processedObjects,
                    })
                }
                this.totalObjectsProcessed += objects.length
                this.events.emit('progress', {
                    progress: {
                        ...syncInfo,
                        totalObjectsProcessed: this.totalObjectsProcessed,
                    },
                })
            }
        }
        await channel.finish()
    }
}

export class FastSyncReceiver {
    public events: TypedEmitter<FastSyncEvents> = new EventEmitter() as any
    private totalObjectsProcessed: number = 0

    constructor(
        private options: {
            storageManager: StorageManager
            channel: FastSyncReceiverChannel
        },
    ) {}

    async execute() {
        const syncInfo = await this.options.channel.receiveSyncInfo()
        this.events.emit('prepared', { syncInfo })

        // console.log('recv: entering loop')
        this.events.emit('progress', {
            progress: {
                ...syncInfo,
                totalObjectsProcessed: this.totalObjectsProcessed,
            },
        })
        for await (const objectBatch of this.options.channel.streamObjectBatches()) {
            // console.log('recv: start iter')
            for (const object of objectBatch.objects) {
                await this.options.storageManager
                    .collection(objectBatch.collection)
                    .createObject(object)
            }
            this.totalObjectsProcessed += objectBatch.objects.length
            this.events.emit('progress', {
                progress: {
                    ...syncInfo,
                    totalObjectsProcessed: this.totalObjectsProcessed,
                },
            })
            // console.log('recv: end iter')
        }
    }
}

async function getSyncInfo(
    storageManager: StorageManager,
): Promise<FastSyncInfo> {
    let collectionCount = 0
    let objectCount = 0
    for (const [collectionName, collectionDefinition] of Object.entries(
        storageManager.registry.collections,
    )) {
        collectionCount += 1
        objectCount += await storageManager
            .collection(collectionName)
            .countObjects({})
    }
    return { collectionCount, objectCount }
}

async function* streamObjectBatches(
    storageManager: StorageManager,
    collection: string,
): AsyncIterableIterator<any[]> {
    // const pkIndex = storageManager.registry.collections[collection]
    // if (typeof pkIndex !== 'string') {
    //     throw new Error(`Only simple PK indices are supported for now (colllection: ${collection})`)
    // }

    for (const object of await storageManager
        .collection(collection)
        .findObjects({})) {
        yield [object]
    }
}
