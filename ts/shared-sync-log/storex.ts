import { StorageModule, StorageModuleConfig } from '@worldbrain/storex-pattern-modules'
import { SharedSyncLog, SharedSyncLogEntry } from './types'

export class SharedSyncLogStorage extends StorageModule implements SharedSyncLog {
    getConfig() : StorageModuleConfig {
        return {
            collections: {
                sharedSyncLogEntry: {
                    version: new Date(2019, 2, 5),
                    fields: {
                        userId: {type: 'string'},
                        deviceId: {type: 'string'},
                        createdOn: {type: 'timestamp'}, // when was this entry created on a device
                        sharedOn: {type: 'timestamp'}, // when was this entry uploaded
                        data: {type: 'string'},
                    },
                },
                sharedSyncLogDeviceInfo: {
                    version: new Date(2019, 2, 5),
                    fields: {
                        userId: {type: 'string'},
                        sharedUntil: {type: 'timestamp'},
                    },
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
                findUnsyncedEntries: {
                    operation: 'findObjects',
                    collection: 'sharedSyncLogEntry',
                    args: [
                        {sharedOn: {$gt: '$sharedUntil:timestamp'}},
                        {sort: ['sharedOn', 'asc']}
                    ]
                }
            },
            methods: {
                createDeviceId: {
                    type: 'mutation',
                    args: {
                        userId: 'string',
                        sharedUntil: 'float'
                    },
                    returns: 'string'
                },
                writeEntries: {
                    type: 'mutation',
                    args: {
                        entries: { type: { array: { collection: 'sharedSyncLogEntry' } }, positional: true },
                    },
                    returns: 'void'
                },
                getUnsyncedEntries: {
                    type: 'query',
                    args: {
                        devicedId: { type: 'string' },
                    },
                    returns: { collection: 'sharedSyncLogEntry' }
                },
                updateSharedUntil: {
                    type: 'mutation',
                    args: {
                        devicedId: { type: 'string' },
                        until: { type: 'float' },
                    },
                    returns: 'void',
                }
            }
        }
    }

    async createDeviceId(options : {userId, sharedUntil : number}) : Promise<string> {
        return (await this.operation('createDeviceInfo', options)).object.id
    }

    async writeEntries(entries : SharedSyncLogEntry[], options : { userId, deviceId }) : Promise<void> {
        for (const entry of entries) {
            await this.operation('createLogEntry', { ...entry, ...options })
        }
    }

    async getUnsyncedEntries(options : { deviceId }) : Promise<SharedSyncLogEntry[]> {
        const deviceInfo = await this.operation('getDeviceInfo', options)
        if (!deviceInfo) {
            return null
        }

        return this.operation('findUnsyncedEntries', { deviceId: options.deviceId, sharedUntil: deviceInfo.sharedUntil })
    }

    async updateSharedUntil(args : {until : number, deviceId}) : Promise<void> {
        await this.operation('updateSharedUntil', { deviceId: args.deviceId, sharedUntil: args.until })
    }
}
