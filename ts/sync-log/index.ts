const sortBy = require('lodash/sortBy')
import StorageManager from "@worldbrain/storex"
import { StorageModule, StorageModuleCollections, StorageModuleConfig, _defaultOperationExecutor } from '@worldbrain/storex-pattern-modules'
import { ClientSyncLogEntry } from "./types"

export class SyncLogStorage extends StorageModule {
    private _storageManager : StorageManager

    constructor({storageManager} : {storageManager : StorageManager}) {
        super({storageManager, operationExecuter: _defaultOperationExecutor(
            storageManager,
            // true
        )})

        this._storageManager = storageManager
    }

    getConfig() : StorageModuleConfig {
        return {
            collections: {
                'syncLog': {
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
                    collection: 'syncLog',
                },
                findEntriesCreatedAfter: {
                    operation: 'findObjects',
                    collection: 'syncLog',
                    args: [
                        {createdOn: {$gte: '$timestamp:timestamp'}},
                    ]
                },
                updateSyncedUntil: {
                    operation: 'updateObjects',
                    collection: 'syncLog',
                    args: [
                        {createdOn: {$lte: '$until:timestamp'}},
                        {syncedOn: '$syncedOn:timestamp'}
                    ]
                },
                findUnsyncedEntries: {
                    operation: 'findObjects',
                    collection: 'syncLog',
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
