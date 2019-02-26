const sortBy = require('lodash/sortBy')
import { StorageModule, StorageModuleConfig } from '@worldbrain/storex-pattern-modules'
import { ClientSyncLogEntry } from "./types"

export class ClientSyncLogStorage extends StorageModule {
    getConfig() : StorageModuleConfig {
        return {
            collections: {
                clientSyncLogEntry: {
                    version: new Date(2019, 2, 5),
                    fields: {
                        createdOn: {type: 'timestamp'},
                        syncedOn: {type: 'timestamp', optional: true},
                        collection: {type: 'string'},
                        pk: {type: 'json'},
                        field: {type: 'string', optional: true},
                        operation: {type: 'string'},
                        value: {type: 'json', optional: true},
                    },
                    indices: [{field: 'createdOn'}]
                }
            },
            operations: {
                createEntry: {
                    operation: 'createObject',
                    collection: 'clientSyncLogEntry',
                },
                findEntriesCreatedAfter: {
                    operation: 'findObjects',
                    collection: 'clientSyncLogEntry',
                    args: [
                        {createdOn: {$gte: '$timestamp:timestamp'}},
                    ]
                },
                updateSyncedUntil: {
                    operation: 'updateObjects',
                    collection: 'clientSyncLogEntry',
                    args: [
                        {createdOn: {$lte: '$until:timestamp'}},
                        {syncedOn: '$syncedOn:timestamp'}
                    ]
                },
                findUnsyncedEntries: {
                    operation: 'findObjects',
                    collection: 'clientSyncLogEntry',
                    args: {
                        syncedOn: {$eq: null},
                    }
                }
            }
        }
    }

    async insertEntries(entries : ClientSyncLogEntry[]) {
        for (const entry of entries) {
            await this.operation('createEntry', entry)
        }
    }

    async getEntriesCreatedAfter(timestamp : number) : Promise<ClientSyncLogEntry[]> {
        return sortBy(await this.operation('findEntriesCreatedAfter', {timestamp}), 'createdOn')
    }

    async updateSyncedUntil({until, syncedOn} : {until : number, syncedOn : number}) {
        await this.operation('updateSyncedUntil', {until, syncedOn})
    }

    async getUnsyncedEntries() {
        return sortBy(await this.operation('findUnsyncedEntries', {}), 'createdOn')
    }
}
