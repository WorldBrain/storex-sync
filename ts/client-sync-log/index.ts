const sortBy = require('lodash/sortBy')
import { StorageModule, StorageModuleConfig } from '@worldbrain/storex-pattern-modules'
import { ClientSyncLogEntry } from "./types"
import { SharedSyncLogEntry } from '../shared-sync-log/types';

export class ClientSyncLogStorage extends StorageModule {
    getConfig() : StorageModuleConfig {
        return {
            collections: {
                clientSyncLogEntry: {
                    version: new Date(2019, 2, 5),
                    fields: {
                        createdOn: {type: 'timestamp'},
                        sharedOn: {type: 'timestamp', optional: true}, // when was this sent or received?
                        needsIntegration: {type: 'boolean', optional: true},
                        collection: {type: 'string'},
                        pk: {type: 'json'},
                        field: {type: 'string', optional: true},
                        operation: {type: 'string'},
                        value: {type: 'json', optional: true},
                    },
                    indices: [
                        {field: 'createdOn'},
                        {field: ['collection', 'pk']}
                    ]
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
                updateSharedUntil: {
                    operation: 'updateObjects',
                    collection: 'clientSyncLogEntry',
                    args: [
                        {createdOn: {$lte: '$until:timestamp'}},
                        {sharedOn: '$sharedOn:timestamp'}
                    ]
                },
                findUnsharedEntries: {
                    operation: 'findObjects',
                    collection: 'clientSyncLogEntry',
                    args: {
                        sharedOn: {$eq: null},
                    }
                },
                markAsIntegrated: {
                    operation: 'updateObjects',
                    collection: 'clientSyncLogEntry',
                    args: [
                        {id: {$in: '$ids:array:pk'}},
                        {needsIntegration: false}
                    ]
                },
                findFirstUnintegratedEntry: {
                    operation: 'findObjects',
                    collection: 'clientSyncLogEntry',
                    args: [
                        { needsIntegration: true },
                        { sort: [['createdOn', 'asc']], limit: 1 }
                    ]
                },
                findEntriesByObjectPk: {
                    operation: 'findObjects',
                    collection: 'clientSyncLogEntry',
                    args: [
                        { collection: '$collection:string', pk: '$pk' },
                        { sort: [['createdOn', 'asc']] }
                    ]
                }
            }
        }
    }

    async insertEntries(entries : ClientSyncLogEntry[]) {
        for (const entry of entries) {
            await this.operation('createEntry', entry)
        }
    }

    async insertReceivedEntries(sharedEntries : SharedSyncLogEntry[], options : {now : number}) {
        await this.insertEntries(sharedEntries.map(sharedEntry => {
            const data = JSON.parse(sharedEntry.data)
            const clientEntry : ClientSyncLogEntry = {
                createdOn: sharedEntry.createdOn,
                sharedOn: options.now,
                needsIntegration: true,
                operation: data.operation,
                collection: data.collection,
                pk: data.pk,
                field: data.field,
                value: data.value,
            }
            return clientEntry
        }))
    }

    async getEntriesCreatedAfter(timestamp : number) : Promise<ClientSyncLogEntry[]> {
        return sortBy(await this.operation('findEntriesCreatedAfter', {timestamp}), 'createdOn')
    }

    async updateSharedUntil({until, sharedOn} : {until : number, sharedOn : number}) {
        await this.operation('updateSharedUntil', {until, sharedOn})
    }

    async getUnsharedEntries() : Promise<ClientSyncLogEntry[]> {
        return sortBy(await this.operation('findUnsharedEntries', {}), 'createdOn')
    }

    async markAsIntegrated(entries : ClientSyncLogEntry[]) {
        await this.operation('markAsIntegrated', {ids: entries.map(entry => entry.id)})
    }

    async getNextEntriesToIntgrate() : Promise<ClientSyncLogEntry[]> {
        const firstEntryList = await this.operation('findFirstUnintegratedEntry', {})
        if (!firstEntryList.length) {
            return null
        }

        const firstEntry = firstEntryList[0]
        const entries = await this.operation('findEntriesByObjectPk', {collection: firstEntry.collection, pk: firstEntry.pk})
        return entries
    }
}
