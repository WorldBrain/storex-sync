import { EventEmitter } from 'events'
import TypedEmitter from 'typed-emitter'
import StorageManager from '@worldbrain/storex'
import {
    FastSyncReceiverChannel,
    FastSyncSenderChannel,
    FastSyncInfo,
    FastSyncProgress,
} from './types'
import Interruptable from './interruptable'

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
    stalled: () => void
    paused: () => void
    resumed: () => void
}

export class FastSyncSender {
    public events: TypedEmitter<
        FastSyncEvents
    > = new EventEmitter() as TypedEmitter<FastSyncEvents>

    private totalObjectsProcessed: number
    private interruptable: Interruptable | null = null
    private _state:
        | 'pristine'
        | 'running'
        | 'done'
        | 'paused'
        | 'cancelled'
        | 'error' = 'pristine'

    constructor(private options: FastSyncSenderOptions) {
        this.totalObjectsProcessed = 0
    }

    get state() {
        return this._state
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

        channel.events.on('stalled', () => this.events.emit('stalled'))
        const interruptable = (this.interruptable = new Interruptable())
        this._state = 'running'
        try {
            const syncInfo = await getSyncInfo(this.options.storageManager)
            this.events.emit('prepared', { syncInfo })
            await channel.sendSyncInfo(syncInfo)

            try {
                await interruptable.execute(async () => {
                    this.events.emit('progress', {
                        progress: {
                            ...syncInfo,
                            totalObjectsProcessed: this.totalObjectsProcessed,
                        },
                    })
                })

                await interruptable.forOfLoop(
                    this.options.collections,
                    async collection => {
                        await interruptable.forOfLoop(
                            streamObjectBatches(
                                this.options.storageManager,
                                collection,
                            ),
                            async objects => {
                                const processedObjects = await preproccesObjects(
                                    {
                                        collection,
                                        objects,
                                    },
                                )
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
                                        totalObjectsProcessed: this
                                            .totalObjectsProcessed,
                                    },
                                })
                            },
                        )
                    },
                )
                this._state = 'done'
            } finally {
                await channel.finish()
            }
        } catch (e) {
            this._state = 'error'
            throw e
        } finally {
            this.interruptable = null
        }
    }

    async pause() {
        if (this.interruptable) {
            this._state = 'paused'
            this.events.emit('paused')
            await this.interruptable.pause()
            await this.options.channel.sendStateChange('paused')
        }
    }

    async resume() {
        if (this.interruptable) {
            this._state = 'running'
            this.events.emit('resumed')
            await this.options.channel.sendStateChange('running')
            await this.interruptable.resume()
        }
    }

    async cancel() {
        if (this.interruptable) {
            this._state = 'cancelled'
            await this.interruptable.cancel()
        }
    }
}

export class FastSyncReceiver {
    public events: TypedEmitter<FastSyncEvents> = new EventEmitter() as any
    private totalObjectsProcessed: number = 0
    private _state: 'pristine' | 'running' | 'paused' | 'done' | 'error' =
        'pristine'

    constructor(
        private options: {
            storageManager: StorageManager
            channel: FastSyncReceiverChannel
        },
    ) {}

    get state() {
        return this._state
    }

    async execute() {
        this._state = 'running'
        const stateChangeHandler = (state: 'paused' | 'resumed') => () => {
            this._state = state === 'paused' ? 'paused' : 'running'
            this.events.emit(state)
        }
        this.options.channel.events.on('stalled', () =>
            this.events.emit('stalled'),
        )
        this.options.channel.events.on('paused', stateChangeHandler('paused'))
        this.options.channel.events.on('resumed', stateChangeHandler('resumed'))
        try {
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
            this._state = 'done'
        } catch (e) {
            this._state = 'error'
            throw e
        }
    }

    getState() {
        return this._state
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
