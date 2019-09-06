import {
    StorageModuleConfig,
    StorageOperationDefinitions,
    AccessRules,
} from '@worldbrain/storex-pattern-modules'
import { CollectionDefinitionMap } from '@worldbrain/storex'
import { Omit } from '../types'
import {
    ClientSyncLogEntry,
    ClientSyncLogModificationEntry,
} from '../client-sync-log/types'

export interface SharedSyncLog {
    createDeviceId(options: {
        userId: number | string
        sharedUntil: number | null
    }): Promise<string>
    writeEntries(
        entries: Omit<SharedSyncLogEntry, 'userId' | 'deviceId' | 'sharedOn'>[],
        options: {
            userId: number | string
            deviceId: string | number
            now?: number | '$now'
        },
    ): Promise<void>
    getUnsyncedEntries(options: {
        userId: string | number
        deviceId: string | number
    }): Promise<SharedSyncLogUpdate>
    markAsSeen(
        update: Pick<SharedSyncLogUpdate, 'memo'>,
        options: {
            userId: string | number
            deviceId: string | number
            now?: number | '$now'
        },
    ): Promise<void>
}
export interface SharedSyncLogUpdate {
    entries: SharedSyncLogEntry[]
    memo?: any
}

interface SharedSyncLogEntryBase {
    userId: number | string
    deviceId: number | string
    createdOn: number | '$now'
    sharedOn: number
}

export type SharedSyncLogEntry<
    SerializedData extends
        | 'serialized-data'
        | 'deserialized-data' = 'serialized-data'
> = SharedSyncLogEntryBase &
    (SerializedData extends 'serialized-data'
        ? { data: string }
        : { data: SharedSyncLogEntryData })

export interface SharedSyncLogEntryData {
    operation: ClientSyncLogEntry['operation']
    collection: ClientSyncLogEntry['collection']
    pk: ClientSyncLogEntry['pk']
    field: ClientSyncLogModificationEntry['field'] | null
    value: ClientSyncLogModificationEntry['value'] | null
}

export function createSharedSyncLogConfig(options: {
    autoPkType: 'int' | 'string'
    collections?: CollectionDefinitionMap
    operations?: StorageOperationDefinitions
    accessRules?: AccessRules
}): StorageModuleConfig {
    return {
        operations: options.operations,
        collections: {
            sharedSyncLogEntry: {
                version: new Date('2019-02-05'),
                fields: {
                    userId: { type: options.autoPkType },
                    deviceId: { type: options.autoPkType },
                    createdOn: { type: 'timestamp' }, // when was this entry created on a device
                    sharedOn: { type: 'timestamp' }, // when was this entry uploaded
                    data: { type: 'string' },
                },
                groupBy: [{ key: 'userId', subcollectionName: 'entries' }],
            },
            sharedSyncLogDeviceInfo: {
                version: new Date('2019-02-05'),
                fields: {
                    userId: { type: options.autoPkType },
                    sharedUntil: { type: 'timestamp', optional: true },
                },
                groupBy: [{ key: 'userId', subcollectionName: 'devices' }],
            },
            ...(options.collections || {}),
        },
        methods: {
            createDeviceId: {
                type: 'mutation',
                args: {
                    userId: options.autoPkType,
                    sharedUntil: 'float',
                },
                returns: options.autoPkType,
            },
            writeEntries: {
                type: 'mutation',
                args: {
                    entries: {
                        type: { array: { collection: 'sharedSyncLogEntry' } },
                        positional: true,
                    },
                },
                returns: 'void',
            },
            getUnsyncedEntries: {
                type: 'query',
                args: {
                    deviceId: { type: options.autoPkType },
                },
                returns: { array: { collection: 'sharedSyncLogEntry' } },
            },
            markAsSeen: {
                type: 'mutation',
                args: {
                    entries: {
                        type: {
                            array: {
                                object: {
                                    createdOn: 'float',
                                    deviceId: options.autoPkType,
                                },
                                singular: 'entry',
                            },
                        },
                    },
                    deviceId: { type: options.autoPkType },
                },
                returns: 'void',
            },
        },
        accessRules: options.accessRules,
    }
}
