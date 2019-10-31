const sortBy = require('lodash/sortBy')
import {
    StorageModule,
    StorageModuleConfig,
} from '@worldbrain/storex-pattern-modules'
import { ClientSyncLogEntry } from './types'
import { SharedSyncLogEntry } from '../shared-sync-log/types'

export class ClientSyncLogStorage extends StorageModule {
    getConfig(): StorageModuleConfig {
        return {
            collections: {
                clientSyncLogEntry: {
                    version: new Date('2019-02-05'),
                    fields: {
                        createdOn: { type: 'timestamp' },
                        sharedOn: { type: 'timestamp', optional: true }, // when was this sent or received?
                        deviceId: { type: 'json' }, // what device did this operation happen on?
                        needsIntegration: { type: 'boolean', optional: true },
                        collection: { type: 'string' },
                        pk: { type: 'json' },
                        field: { type: 'string', optional: true },
                        operation: { type: 'string' },
                        value: { type: 'json', optional: true },
                    },
                    indices: [
                        { field: 'createdOn' },
                        { field: ['collection', 'pk'] },
                    ],
                },
                // clientSyncLogInfo: {
                //     version: new Date('2019-02-05'),
                //     fields: {
                //         receivalStartedWhen: { type: 'datetime' },
                //     }
                // },
            },
            operations: {
                createEntry: {
                    operation: 'createObject',
                    collection: 'clientSyncLogEntry',
                },
                findEntriesCreatedAfter: {
                    operation: 'findObjects',
                    collection: 'clientSyncLogEntry',
                    args: [{ createdOn: { $gte: '$timestamp:timestamp' } }],
                },
                updateSharedUntil: {
                    operation: 'updateObjects',
                    collection: 'clientSyncLogEntry',
                    args: [
                        { createdOn: { $lte: '$until:timestamp' } },
                        { sharedOn: '$sharedOn:timestamp' },
                    ],
                },
                findUnsharedEntries: {
                    operation: 'findObjects',
                    collection: 'clientSyncLogEntry',
                    args: {
                        sharedOn: { $eq: null },
                    },
                },
                markAsIntegrated: {
                    operation: 'updateObjects',
                    collection: 'clientSyncLogEntry',
                    args: [
                        { id: { $in: '$ids:array:pk' } },
                        { needsIntegration: false },
                    ],
                },
                findFirstUnintegratedEntry: {
                    operation: 'findObjects',
                    collection: 'clientSyncLogEntry',
                    args: [
                        { needsIntegration: true },
                        { order: [['createdOn', 'asc']], limit: 1 },
                    ],
                },
                findEntriesByObjectPk: {
                    operation: 'findObjects',
                    collection: 'clientSyncLogEntry',
                    args: [
                        { collection: '$collection:string', pk: '$pk' },
                        { order: [['createdOn', 'asc']] },
                    ],
                },
            },
        }
    }

    async insertEntries(entries: ClientSyncLogEntry[]) {
        for (const entry of entries) {
            await this.operation('createEntry', entry)
        }
    }

    async insertReceivedEntries(
        sharedEntries: Array<SharedSyncLogEntry<'deserialized-data'>>,
        options: { now: number | '$now' },
    ) {
        await this.insertEntries(
            sharedEntries.map(
                (sharedEntry): ClientSyncLogEntry => {
                    const data = sharedEntry.data
                    const common = {
                        createdOn: sharedEntry.createdOn,
                        sharedOn:
                            typeof options.now === 'string'
                                ? Date.now()
                                : options.now,
                        deviceId: sharedEntry.deviceId,
                        needsIntegration: true,
                        collection: data.collection,
                        pk: data.pk,
                    }
                    if (data.operation === 'create') {
                        return {
                            ...common,
                            operation: 'create',
                            value: data.value,
                        }
                    } else if (data.operation === 'modify') {
                        return {
                            ...common,
                            operation: 'modify',
                            field: data.field!,
                            value: data.value,
                        }
                    } else if (data.operation === 'delete') {
                        return {
                            ...common,
                            operation: 'delete',
                        }
                    } else {
                        throw new Error(
                            `Unknown operation received: ${data.operation}`,
                        )
                    }
                },
            ),
        )
    }

    async getEntriesCreatedAfter(
        timestamp: number,
    ): Promise<ClientSyncLogEntry[]> {
        return sortBy(
            await this.operation('findEntriesCreatedAfter', { timestamp }),
            'createdOn',
        )
    }

    async updateSharedUntil({
        until,
        sharedOn,
    }: {
        until: number | '$now'
        sharedOn: number | '$now'
    }) {
        await this.operation('updateSharedUntil', { until, sharedOn })
    }

    async getUnsharedEntries(): Promise<ClientSyncLogEntry[]> {
        return sortBy(
            await this.operation('findUnsharedEntries', {}),
            'createdOn',
        )
    }

    async markAsIntegrated(entries: ClientSyncLogEntry[]) {
        await this.operation('markAsIntegrated', {
            ids: entries.map(entry => entry.id),
        })
    }

    async getNextEntriesToIntgrate(): Promise<ClientSyncLogEntry[] | null> {
        const firstEntryList = await this.operation(
            'findFirstUnintegratedEntry',
            {},
        )
        if (!firstEntryList.length) {
            return null
        }

        const firstEntry = firstEntryList[0]
        const entries = await this.operation('findEntriesByObjectPk', {
            collection: firstEntry.collection,
            pk: firstEntry.pk,
        })
        return entries
    }
}
