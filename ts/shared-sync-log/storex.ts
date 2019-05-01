import * as flatten from 'lodash/flatten'
import * as sortBy from 'lodash/sortBy'
import { StorageModule, StorageModuleConfig, StorageModuleConstructorArgs, StorageModuleDebugConfig } from '@worldbrain/storex-pattern-modules'
import { SharedSyncLog, SharedSyncLogEntry, createSharedSyncLogConfig } from './types'
import { Omit } from '../types';

export class SharedSyncLogStorage extends StorageModule implements SharedSyncLog {
    constructor(private options : StorageModuleConstructorArgs & { autoPkType : 'string' | 'int', excludeTimestampChecks? : boolean }) {
        super(options)
    }

    getConfig : () => StorageModuleConfig = () =>
        createSharedSyncLogConfig({
            autoPkType: this.options.autoPkType,
            collections: {
                sharedSyncLogEntryBatch: {
                    version: new Date('2019-02-05'),
                    fields: {
                        userId: { type: this.options.autoPkType },
                        deviceId: { type: this.options.autoPkType },
                        createdOn: { type: 'timestamp' }, // when was this entry created on a device
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
                    groupBy: [{ key: 'userId', subcollectionName: 'entries' }]
                },
            },
            operations: {
                createDeviceInfo: {
                    operation: 'createObject',
                    collection: 'sharedSyncLogDeviceInfo',
                },
                getDeviceInfo: {
                    operation: 'findObject',
                    collection: 'sharedSyncLogDeviceInfo',
                    args: { userId: '$userId:pk', id: '$deviceId:pk' }
                },
                updateSharedUntil: {
                    operation: 'updateObjects',
                    collection: 'sharedSyncLogDeviceInfo',
                    args: [{ userId: '$userId:pk', id: '$deviceId:pk' }, {sharedUntil: '$sharedUntil:timestamp'}]
                },
                createLogEntry: {
                    operation: 'createObject',
                    collection: 'sharedSyncLogEntryBatch',
                },
                findSyncEntries: {
                    operation: 'findObjects',
                    collection: 'sharedSyncLogEntryBatch',
                    args: [
                        { userId: '$userId' },
                    ]
                },
                insertSeenEntries: {
                    operation: 'executeBatch',
                    args: ['$operations']
                },
                retrieveSeenEntries: {
                    operation: 'findObjects',
                    collection: 'sharedSyncLogSeenEntry',
                    args: { userId: '$userId:pk', retrieverDeviceId: '$deviceId:pk' }
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
                    sharedSyncLogDeviceInfo: !this.options.excludeTimestampChecks ? [
                        {
                            field: 'updatedWhen',
                            rule: { or: [
                                { eq: ['$value', null] },
                                { eq: ['$value', '$context.now'] },
                            ] }
                        }
                    ] : []
                },
            }
        })

    async createDeviceId(options : {userId, sharedUntil : number}) : Promise<string> {
        return (await this.operation('createDeviceInfo', options)).object.id
    }

    async writeEntries(entries : Omit<SharedSyncLogEntry, 'sharedOn'>[], options? : { now : number | '$now' }) : Promise<void> {
        for (const entry of entries) {
            await this.operation('createLogEntry', { ...entry, sharedOn: (options && options.now) || '$now' })
        }
    }

    async getUnsyncedEntries(options : { userId : string | number, deviceId : string | number }) : Promise<SharedSyncLogEntry[]> {
        const deviceInfo = await this.operation('getDeviceInfo', options)
        if (!deviceInfo) {
            throw new Error(`Cannot find device ID: ${JSON.stringify(options.deviceId)}`)
        }
        const seenEntries = await this.operation('retrieveSeenEntries', { userId: deviceInfo.userId, deviceId: options.deviceId })
        const seenSet = new Set(seenEntries.map(entry => entry.createdOn))
        const entriesBatch = await this.operation('findSyncEntries', { userId: deviceInfo.userId, fromWhen: 0 })
        const unseenEntryBatches = entriesBatch.filter(entry => !seenSet.has(entry.createdOn))
        return sortBy(flatten(unseenEntryBatches), 'createdOn')
    }

    async markAsSeen(entries : Array<{ deviceId, createdOn : number }>, options : { userId : string | number, deviceId : string | number, now? : number | '$now' }) : Promise<void> {
        if (!entries.length) {
            return
        }

        await this.operation('insertSeenEntries', { operations: entries.map(entry => ({
            placeholder: 'seenEntry',
            operation: 'createObject',
            collection: 'sharedSyncLogSeenEntry',
            args: {
                userId: options.userId,
                creatorDeviceId: entry.deviceId,
                createdOn: entry.createdOn,
                retrieverDeviceId: options.deviceId,
            }
        }))})
        await this.operation('updateSharedUntil', {
            userId: options.userId,
            deviceId: options.deviceId,
            sharedUntil: options.now || '$now'
        })
    }
}
