import { StorageModule, StorageModuleConfig, StorageModuleConstructorArgs, StorageModuleDebugConfig } from '@worldbrain/storex-pattern-modules'
import { SharedSyncLog, SharedSyncLogEntry, createSharedSyncLogConfig } from './types'

export class SharedSyncLogStorage extends StorageModule implements SharedSyncLog {
    private autoPkType : 'string' | 'int'

    constructor(options : StorageModuleConstructorArgs & { autoPkType : 'string' | 'int' }) {
        super(options)
        this.autoPkType = options.autoPkType
    }

    getConfig : () => StorageModuleConfig = () =>
        createSharedSyncLogConfig({
            autoPkType: this.autoPkType,
            collections: {
                sharedSyncLogSeenEntry: {
                    version: new Date('2019-02-05'),
                    fields: {
                        creatorDeviceId: { type: this.autoPkType },
                        retrieverDeviceId: { type: this.autoPkType },
                        createdOn: { type: 'timestamp' },
                    },
                    indices: [ { field: ['retrieverDeviceId', 'createdOn'] } ]
                }
            },
            operations: {
                createDeviceInfo: {
                    operation: 'createObject',
                    collection: 'sharedSyncLogDeviceInfo',
                },
                getDeviceInfo: {
                    operation: 'findObject',
                    collection: 'sharedSyncLogDeviceInfo',
                    args: {id: '$deviceId'}
                },
                updateSharedUntil: {
                    operation: 'updateObjects',
                    collection: 'sharedSyncLogDeviceInfo',
                    args: [{id: '$deviceId'}, {sharedUntil: '$sharedUntil:timestamp'}]
                },
                createLogEntry: {
                    operation: 'createObject',
                    collection: 'sharedSyncLogEntry',
                },
                findSyncEntries: {
                    operation: 'findObjects',
                    collection: 'sharedSyncLogEntry',
                    args: [
                        {
                            userId: '$userId',
                            sharedOn: {$gt: '$fromWhen:timestamp'},
                        },
                        {sort: ['sharedOn', 'asc']}
                    ]
                },
                insertSeenEntries: {
                    operation: 'executeBatch',
                    args: ['$operations']
                },
                retrieveSeenEntries: {
                    operation: 'findObjects',
                    collection: 'sharedSyncLogSeenEntry',
                    args: { retrieverDeviceId: '$deviceId' }
                },
            },
        })

    async createDeviceId(options : {userId, sharedUntil : number}) : Promise<string> {
        return (await this.operation('createDeviceInfo', options)).object.id
    }

    async writeEntries(entries : SharedSyncLogEntry[]) : Promise<void> {
        for (const entry of entries) {
            await this.operation('createLogEntry', entry)
        }
    }

    async getUnsyncedEntries(options : { deviceId }) : Promise<SharedSyncLogEntry[]> {
        const deviceInfo = await this.operation('getDeviceInfo', options)
        if (!deviceInfo) {
            throw new Error(`Cannot find device ID: ${JSON.stringify(options.deviceId)}`)
        }
        const seenEntries = await this.operation('retrieveSeenEntries', { deviceId: options.deviceId })
        const seenSet = new Set(seenEntries.map(entry => entry.createdOn))
        const entries = await this.operation('findSyncEntries', { userId: deviceInfo.userId, fromWhen: 0 })
        const unseenEntries = entries.filter(entry => !seenSet.has(entry.createdOn))
        return unseenEntries
    }

    async markAsSeen(entries : Array<{ deviceId, createdOn : number }>, options : { deviceId }) : Promise<void> {
        if (!entries.length) {
            return
        }

        await this.operation('insertSeenEntries', { operations: entries.map(entry => ({
            placeholder: 'seenEntry',
            operation: 'createObject',
            collection: 'sharedSyncLogSeenEntry',
            args: {
                creatorDeviceId: entry.deviceId,
                createdOn: entry.createdOn,
                retrieverDeviceId: options.deviceId,
            }
        }))})
    }
}
