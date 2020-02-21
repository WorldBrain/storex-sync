import { StorageRegistry } from '@worldbrain/storex'
import { getObjectWithoutPk } from '@worldbrain/storex/lib/utils'
import { StorageOperationChangeInfo } from '@worldbrain/storex-middleware-change-watcher/lib/types'
import {
    ClientSyncLogEntry,
    ClientSyncLogEntryMetadata,
} from '../client-sync-log/types'

export async function convertChangeInfoToClientSyncLogEntries(
    info: StorageOperationChangeInfo<'pre'>,
    options: {
        createMetadata: () => Promise<ClientSyncLogEntryMetadata>
        storageRegistry: StorageRegistry
    },
) {
    const entries: ClientSyncLogEntry[] = []
    const addEntry = (entry: ClientSyncLogEntry) => {
        entries.push(entry)
    }

    for (const change of info.changes) {
        if (change.type === 'create') {
            addEntry({
                operation: 'create',
                ...(await options.createMetadata()),
                collection: change.collection,
                pk: change.pk,
                value: getObjectWithoutPk(
                    change.values,
                    change.collection,
                    options.storageRegistry,
                ),
            })
        } else if (change.type === 'modify') {
            for (const pk of change.pks) {
                addEntry({
                    operation: 'modify',
                    ...(await options.createMetadata()),
                    collection: change.collection,
                    pk: pk as number | string,
                    value: change.updates,
                })
            }
        } else if (change.type === 'delete') {
            for (const pk of change.pks) {
                addEntry({
                    operation: 'delete',
                    ...(await options.createMetadata()),
                    collection: change.collection,
                    pk: pk as number | string,
                })
            }
        }
    }
    return entries
}
