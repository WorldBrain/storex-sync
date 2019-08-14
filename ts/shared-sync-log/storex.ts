import flatten from 'lodash/flatten'
import sortBy from 'lodash/sortBy'
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
} from './types'
import { Omit } from '../types'

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
                sharedSyncLogSeenEntry: {
                    version: new Date('2019-02-05'),
                    fields: {
                        userId: { type: this.options.autoPkType },
                        creatorDeviceId: { type: this.options.autoPkType },
                        retrieverDeviceId: { type: this.options.autoPkType },
                        createdOn: { type: 'timestamp' },
                    },
                    groupBy: [{ key: 'userId', subcollectionName: 'entries' }],
                },
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
                findSyncEntries: {
                    operation: 'findObjects',
                    collection: 'sharedSyncLogEntryBatch',
                    args: [{ userId: '$userId' }],
                },
                insertSeenEntries: {
                    operation: 'executeBatch',
                    args: ['$operations'],
                },
                retrieveSeenEntries: {
                    operation: 'findObjects',
                    collection: 'sharedSyncLogSeenEntry',
                    args: {
                        userId: '$userId:pk',
                        retrieverDeviceId: '$deviceId:pk',
                    },
                },
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
                    sharedSyncLogSeenEntry: {
                        field: 'userId',
                        access: ['list', 'read', 'create', 'delete'],
                    },
                },
                validation: {
                    sharedSyncLogDeviceInfo: !this.options
                        .excludeTimestampChecks
                        ? [
                              {
                                  field: 'sharedUntil',
                                  rule: { eq: ['$value', '$context.now'] },
                              },
                          ]
                        : [],
                },
            },
        })

    // debug = true

    async createDeviceId(options: {
        userId: number | string
        sharedUntil?: number | null
    }): Promise<string> {
        if (!options.sharedUntil) {
            options.sharedUntil = null
        }
        return (await this.operation('createDeviceInfo', options)).object.id
    }

    async writeEntries(
        entries: Omit<SharedSyncLogEntry, 'userId' | 'deviceId' | 'sharedOn'>[],
        options: {
            userId: number | string
            deviceId: string | number
            now: number | '$now'
        },
    ): Promise<void> {
        await this.operation('createLogEntryBatch', {
            data: JSON.stringify(entries),
            userId: options.userId,
            deviceId: options.deviceId,
            sharedOn: (options && options.now) || '$now',
        })
    }

    async getUnsyncedEntries(options: {
        userId: string | number
        deviceId: string | number
    }): Promise<SharedSyncLogEntry[]> {
        const seenEntries = await this.operation('retrieveSeenEntries', {
            userId: options.userId,
            deviceId: options.deviceId,
        })
        const seenSet = new Set(
            seenEntries.map(
                (entry: Pick<SharedSyncLogEntry, 'createdOn'>) =>
                    entry.createdOn,
            ),
        )

        const entryBatches = await this.operation('findSyncEntries', {
            userId: options.userId,
            fromWhen: 0,
        })
        const entries = flatten(
            entryBatches.map(
                (batch: {
                    data: string
                    deviceId: number | string
                    sharedOn: number
                }): SharedSyncLogEntry[] =>
                    JSON.parse(batch.data).map((entry: SharedSyncLogEntry) => ({
                        ...entry,
                        sharedOn: batch.sharedOn,
                        deviceId: batch.deviceId,
                        userId: options.userId,
                    })),
            ),
        ) as SharedSyncLogEntry[]

        const unseenEntries = entries.filter(
            (entry: SharedSyncLogEntry) => !seenSet.has(entry.createdOn),
        )
        return sortBy(unseenEntries, 'createdOn')
    }

    async markAsSeen(
        entries: Array<{ deviceId: string | number; createdOn: number }>,
        options: {
            userId: string | number
            deviceId: string | number
            now?: number | '$now'
        },
    ): Promise<void> {
        if (!entries.length) {
            return
        }

        await this.operation('insertSeenEntries', {
            operations: entries.map(entry => ({
                placeholder: 'seenEntry',
                operation: 'createObject',
                collection: 'sharedSyncLogSeenEntry',
                args: {
                    userId: options.userId,
                    creatorDeviceId: entry.deviceId,
                    createdOn: entry.createdOn,
                    retrieverDeviceId: options.deviceId,
                },
            })),
        })
        await this.operation('updateSharedUntil', {
            userId: options.userId,
            deviceId: options.deviceId,
            sharedUntil: options.now || '$now',
        })
    }
}
