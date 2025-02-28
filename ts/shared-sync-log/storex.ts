import flatten from 'lodash/flatten'
import sortBy from 'lodash/sortBy'
import omit from 'lodash/omit'
import {
    StorageModule,
    StorageModuleConfig,
    StorageModuleConstructorArgs,
    StorageModuleDebugConfig,
} from '@worldbrain/storex-pattern-modules'
import {
    SharedSyncLog,
    SharedSyncLogEntry,
    createSharedSyncLogConfig,
    SharedSyncLogUpdate,
} from './types'
import { Omit } from '../types'

interface SharedSyncLogEntryBatch {
    userId: string | number
    deviceId: string | number
    sharedOn: number
    data: string
}

export class SharedSyncLogStorage extends StorageModule
    implements SharedSyncLog {
    constructor(
        private options: StorageModuleConstructorArgs & {
            autoPkType: 'string' | 'int'
            excludeTimestampChecks?: boolean
        },
    ) {
        super(options)
    }

    getConfig: () => StorageModuleConfig = () =>
        createSharedSyncLogConfig({
            autoPkType: this.options.autoPkType,
            collections: {
                sharedSyncLogEntryBatch: {
                    version: new Date('2019-02-05'),
                    fields: {
                        userId: { type: this.options.autoPkType },
                        deviceId: { type: this.options.autoPkType },
                        sharedOn: { type: 'timestamp' }, // when was this entry uploaded
                        data: { type: 'string' },
                    },
                    groupBy: [{ key: 'userId', subcollectionName: 'entries' }],
                },
                // sharedSyncLogSeenEntry: {
                //     version: new Date('2019-02-05'),
                //     fields: {
                //         userId: { type: this.options.autoPkType },
                //         creatorDeviceId: { type: this.options.autoPkType },
                //         retrieverDeviceId: { type: this.options.autoPkType },
                //         createdOn: { type: 'timestamp' },
                //     },
                //     groupBy: [{ key: 'userId', subcollectionName: 'entries' }],
                // },
            },
            operations: {
                createDeviceInfo: {
                    operation: 'createObject',
                    collection: 'sharedSyncLogDeviceInfo',
                    args: {
                        userId: '$userId:pk',
                    },
                },
                getDeviceInfo: {
                    operation: 'findObject',
                    collection: 'sharedSyncLogDeviceInfo',
                    args: { userId: '$userId:pk', id: '$deviceId:pk' },
                },
                updateSharedUntil: {
                    operation: 'updateObjects',
                    collection: 'sharedSyncLogDeviceInfo',
                    args: [
                        { userId: '$userId:pk', id: '$deviceId:pk' },
                        { sharedUntil: '$sharedUntil:timestamp' },
                    ],
                },
                createLogEntryBatch: {
                    operation: 'createObject',
                    collection: 'sharedSyncLogEntryBatch',
                },
                findUnseenSyncEntries: {
                    operation: 'findObjects',
                    collection: 'sharedSyncLogEntryBatch',
                    args: [
                        {
                            userId: '$userId',
                            sharedOn: { $gt: '$after:timestamp' },
                        },
                    ],
                },
                // insertSeenEntries: {
                //     operation: 'executeBatch',
                //     args: ['$operations'],
                // },
                // retrieveSeenEntries: {
                //     operation: 'findObjects',
                //     collection: 'sharedSyncLogSeenEntry',
                //     args: {
                //         userId: '$userId:pk',
                //         retrieverDeviceId: '$deviceId:pk',
                //     },
                // },
            },
            accessRules: {
                ownership: {
                    sharedSyncLogDeviceInfo: {
                        field: 'userId',
                        access: ['list', 'read', 'create', 'update', 'delete'],
                    },
                    sharedSyncLogEntryBatch: {
                        field: 'userId',
                        access: ['list', 'read', 'create', 'delete'],
                    },
                    // sharedSyncLogSeenEntry: {
                    //     field: 'userId',
                    //     access: ['list', 'read', 'create', 'delete'],
                    // },
                },
                // validation: {
                //     sharedSyncLogDeviceInfo: !this.options
                //         .excludeTimestampChecks
                //         ? [
                //               {
                //                   field: 'sharedUntil',
                //                   rule: { eq: ['$value', '$context.now'] },
                //               },
                //           ]
                //         : [],
                // },
            },
        })

    async createDeviceId(options: {
        userId: number | string
        sharedUntil?: number | null
    }): Promise<string> {
        if (typeof options.sharedUntil === 'undefined') {
            options.sharedUntil = 0
        }
        return (await this.operation('createDeviceInfo', options)).object.id
    }

    async getDeviceInfo(options: {
        userId: number | string
        deviceId: number | string
    }): Promise<{ sharedUntil: number | null } | null> {
        const deviceInfo: { sharedUntil: number | null } = await this.operation(
            'getDeviceInfo',
            options,
        )
        if (!deviceInfo) {
            return null
        }

        if (!deviceInfo.sharedUntil) {
            deviceInfo.sharedUntil = null
        }

        return deviceInfo
    }

    async writeEntries(
        entries: Omit<SharedSyncLogEntry, 'userId' | 'deviceId' | 'sharedOn'>[],
        options: {
            userId: number | string
            deviceId: string | number
            now: number | '$now'
            extraSentInfo?: any
        },
    ): Promise<void> {
        if (!entries.length) {
            return
        }

        const batch: SharedSyncLogEntryBatch = {
            data: JSON.stringify({ entries, extraInfo: options.extraSentInfo }),
            userId: options.userId,
            deviceId: options.deviceId,
            sharedOn: (options && options.now) || ('$now' as any),
        }
        await this.operation('createLogEntryBatch', batch)
    }

    async getUnsyncedEntries(options: {
        userId: string | number
        deviceId: string | number
    }): Promise<SharedSyncLogUpdate> {
        const deviceInfo: { sharedUntil: number } = await this.operation(
            'getDeviceInfo',
            options,
        )
        if (!deviceInfo) {
            throw new Error(`No such device: ${options.deviceId}`)
        }

        const entryBatches: Array<SharedSyncLogEntryBatch> = await this.operation(
            'findUnseenSyncEntries',
            {
                userId: options.userId,
                after: deviceInfo.sharedUntil || 0,
            },
        )

        const lastBatch = entryBatches.length
            ? entryBatches[entryBatches.length - 1]
            : null
        const lastBatchTime = lastBatch && lastBatch.sharedOn

        const entries = flatten(
            entryBatches
                .filter(batch => batch.deviceId !== options.deviceId)
                .map((batch): SharedSyncLogEntry[] => {
                    const batchData = JSON.parse(batch.data)
                    return batchData.entries.map(
                        (entry: SharedSyncLogEntry) => ({
                            ...entry,
                            sharedOn: batch.sharedOn,
                            deviceId: batch.deviceId,
                            userId: options.userId,
                            extraInfo: batchData.extraInfo,
                        }),
                    )
                }),
        ) as SharedSyncLogEntry[]

        return {
            entries: sortBy(entries, 'createdOn'),
            memo: { lastBatchTime },
        }
    }

    async markAsSeen(
        update: SharedSyncLogUpdate,
        options: {
            userId: string | number
            deviceId: string | number
            now?: number | '$now'
        },
    ): Promise<void> {
        const sharedUntil = update.entries.length
            ? update.memo.lastBatchTime
            : options.now ?? Date.now()

        await this.operation('updateSharedUntil', {
            userId: options.userId,
            deviceId: options.deviceId,
            sharedUntil,
        })
    }
}
