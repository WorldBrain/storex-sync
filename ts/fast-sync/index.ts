import { EventEmitter } from 'events'
import TypedEmitter from 'typed-emitter'
import StorageManager from '@worldbrain/storex'
import {
    FastSyncInfo,
    FastSyncProgress,
    FastSyncChannel,
    FastSyncRole,
    FastSyncOrder,
    flippedRole,
} from './types'
import Interruptable from './interruptable'
import { getFastSyncInfo } from './utils'

export interface FastSyncOptions {
    storageManager: StorageManager
    channel: FastSyncChannel
    collections: string[]
    batchSize?: number
    preSendProcessor?: FastSyncPreSendProcessor
    postReceiveProcessor?: FastSyncPreSendProcessor
}

export type FastSyncPreSendProcessor = (
    params: FastSyncPreSendProcessorParams,
) => Promise<{ object: any | null }>
export interface FastSyncPreSendProcessorParams {
    collection: string
    object: any
}

export interface FastSyncEvents {
    prepared: (event: { syncInfo: FastSyncInfo; role: FastSyncRole }) => void
    progress: (event: {
        progress: FastSyncProgress
        role: FastSyncRole
    }) => void
    paused: () => void
    resumed: () => void
    channelTimeout: () => void
    packageStalled: () => void
    roleSwitch: (event: { before: FastSyncRole; after: FastSyncRole }) => void
    error: (event: { error: string }) => void
}

export class FastSync {
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

    constructor(private options: FastSyncOptions) {
        this.totalObjectsProcessed = 0
    }

    get state() {
        return this._state
    }

    async execute(options: {
        role: FastSyncRole
        bothWays?: FastSyncOrder
        fastSyncInfo?: FastSyncInfo
    }) {
        const initialRole: FastSyncRole = options.bothWays
            ? options.bothWays === 'receive-first'
                ? 'receiver'
                : 'sender'
            : options.role
        const subsequentRole: FastSyncRole | null = options.bothWays
            ? flippedRole(initialRole)
            : null

        const execute = async (
            role: FastSyncRole,
            fastSyncInfo?: FastSyncInfo,
        ) => {
            this.totalObjectsProcessed = 0
            this.setupTimeoutListeners(this.options.channel)
            if (role === 'sender') {
                await this.send({ role, fastSyncInfo })
            } else {
                await this.receive({ role })
            }
        }

        await execute(initialRole, options.fastSyncInfo)
        if (subsequentRole) {
            this.events.emit('roleSwitch', {
                before: initialRole,
                after: subsequentRole,
            })
            await execute(subsequentRole)
        }
    }

    async send(options: { role: FastSyncRole; fastSyncInfo?: FastSyncInfo }) {
        const { channel } = this.options

        const interruptable = (this.interruptable = new Interruptable())
        this._state = 'running'
        try {
            const syncInfo =
                options.fastSyncInfo ||
                (await getFastSyncInfo(this.options.storageManager, {
                    collections: this.options.collections,
                }))
            this.events.emit('prepared', { syncInfo, role: options.role })
            await channel.sendSyncInfo(syncInfo)

            try {
                await interruptable.execute(async () => {
                    this.events.emit('progress', {
                        role: options.role,
                        progress: {
                            ...syncInfo,
                            totalObjectsProcessed: this.totalObjectsProcessed,
                        },
                    })
                })

                await interruptable.forOfLoop(
                    this.options.collections,
                    async collection => {
                        await this.sendObjecsInCollection(collection, {
                            channel,
                            role: options.role,
                            syncInfo,
                        })
                    },
                )
                this._state = 'done'
            } finally {
                await channel.finish()
            }
        } catch (e) {
            this._state = 'error'
            this.events.emit('error', { error: `${e}` })
            throw e
        } finally {
            this.interruptable = null
        }
    }

    private setupTimeoutListeners(channel: FastSyncChannel<any>) {
        channel.events.on('channelTimeout', () => this.events.emit('channelTimeout'))
        channel.events.on('packageStalled', () => this.events.emit('packageStalled'))
    }

    private async sendObjecsInCollection(
        collection: string,
        options: {
            channel: FastSyncChannel<any>
            role: FastSyncRole
            syncInfo: FastSyncInfo
        },
    ) {
        const batchStream = streamObjectBatches(
            this.options.storageManager,
            collection,
            { batchSize: this.options.batchSize || 100 },
        )
        await this.interruptable!.forOfLoop(batchStream, async objects => {
            const processedObjects = await this._preproccesObjects({
                collection,
                objects,
            })
            if (processedObjects.length) {
                await options.channel.sendObjectBatch({
                    collection,
                    objects: processedObjects,
                })
            }
            this.totalObjectsProcessed += objects.length
            this.events.emit('progress', {
                role: options.role,
                progress: {
                    ...options.syncInfo,
                    totalObjectsProcessed: this.totalObjectsProcessed,
                },
            })
        })
    }

    async _preproccesObjects(params: { collection: string; objects: any[] }) {
        const preSendProcessor = this.options.preSendProcessor
        if (!preSendProcessor) {
            return params.objects
        }

        const processedObjects = (
            await Promise.all(
                params.objects.map(
                    async object =>
                        (
                            await preSendProcessor({
                                collection: params.collection,
                                object,
                            })
                        ).object,
                ),
            )
        ).filter(object => !!object)
        return processedObjects
    }

    async receive(options: { role: FastSyncRole }) {
        this._state = 'running'
        const stateChangeHandler = (state: 'paused' | 'resumed') => () => {
            this._state = state === 'paused' ? 'paused' : 'running'
            this.events.emit(state)
        }

        this.options.channel.events.on('paused', stateChangeHandler('paused'))
        this.options.channel.events.on('resumed', stateChangeHandler('resumed'))
        try {
            const syncInfo = await this.options.channel.receiveSyncInfo()
            this.events.emit('prepared', { syncInfo, role: options.role })

            // console.log('recv: entering loop')
            this.events.emit('progress', {
                role: options.role,
                progress: {
                    ...syncInfo,
                    totalObjectsProcessed: this.totalObjectsProcessed,
                },
            })
            for await (const objectBatch of this.options.channel.streamObjectBatches()) {
                // console.log('recv: start iter')
                for (const object of objectBatch.objects) {
                    await this.options.storageManager.backend.createObject(
                        objectBatch.collection,
                        object,
                    )
                }
                this.totalObjectsProcessed += objectBatch.objects.length
                this.events.emit('progress', {
                    role: options.role,
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

    async abort() {
        await this.cancel()
    }
}

async function* streamObjectBatches(
    storageManager: StorageManager,
    collection: string,
    options: { batchSize: number },
): AsyncIterableIterator<any[]> {
    // const pkIndex = storageManager.registry.collections[collection]
    // if (typeof pkIndex !== 'string') {
    //     throw new Error(`Only simple PK indices are supported for now (colllection: ${collection})`)
    // }

    if (storageManager.backend.supports('streamObjects')) {
        let objects: any[] = []

        const objectStream = await storageManager.operation(
            'streamObjects',
            collection,
        )
        for await (const object of objectStream) {
            objects.push(object)
            if (objects.length >= options.batchSize) {
                yield objects
                objects = []
            }
        }
        if (objects.length > 0) {
            yield objects
        }
    } else {
        for (const object of await storageManager
            .collection(collection)
            .findObjects({})) {
            yield [object]
        }
    }
}
