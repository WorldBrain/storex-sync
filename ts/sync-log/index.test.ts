import * as expect from 'expect'
import StorageManager from '@worldbrain/storex'
import { DexieStorageBackend } from '@worldbrain/storex-backend-dexie'
import inMemory from '@worldbrain/storex-backend-dexie/lib/in-memory'
import { SyncLogStorage } from './';
import { registerModuleCollections } from '@worldbrain/storex-pattern-modules';
import { ClientSyncLogEntry } from './types';

async function setupTest() {
    const backend = new DexieStorageBackend({idbImplementation: inMemory(), dbName: 'unittest'})
    const storageManager = new StorageManager({backend: backend as any})
    const syncLogStorage = new SyncLogStorage({storageManager})
    registerModuleCollections(storageManager.registry, syncLogStorage)
    await storageManager.finishInitialization()
    return { syncLogStorage }
}

describe('Client sync log', () => {
    it('should store and retrieve entries correctly', async () => {
        const { syncLogStorage } = await setupTest()

        const entries : ClientSyncLogEntry[] = [
            {
                createdOn: 2,
                syncedOn: null,
                collection: 'user',
                pk: '1:1',
                operation: 'create',
                value: { displayName: 'Joe' },
            },
            {
                createdOn: 4,
                syncedOn: null,
                collection: 'user',
                pk: '1:2',
                operation: 'create',
                value: { displayName: 'Joe' },
            },
        ]
        await syncLogStorage.insertEntries(entries)

        expect(await syncLogStorage.getEntriesCreatedAfter(2)).toEqual([
            {...entries[0], id: 1},
            {...entries[1], id: 2},
        ])
        expect(await syncLogStorage.getEntriesCreatedAfter(3)).toEqual([
            {...entries[1], id: 2},
        ])
    })

    it('should store and retrieve entries received out-of-order correctly', async () => {
        const { syncLogStorage } = await setupTest()

        const entries : ClientSyncLogEntry[] = [
            {
                createdOn: 2,
                syncedOn: null,
                collection: 'user',
                pk: '1:1',
                operation: 'create',
                value: { displayName: 'Joe' },
            },
            {
                createdOn: 3,
                syncedOn: null,
                collection: 'user',
                pk: '2:1',
                operation: 'create',
                value: { displayName: 'Joe' },
            },
            {
                createdOn: 4,
                syncedOn: null,
                collection: 'user',
                pk: '1:2',
                operation: 'create',
                value: { displayName: 'Joe' },
            },
        ]
        await syncLogStorage.insertEntries([entries[0], entries[2]])
        await syncLogStorage.insertEntries([entries[1]])

        expect(await syncLogStorage.getEntriesCreatedAfter(2)).toEqual([
            {...entries[0], id: 1},
            {...entries[1], id: 3},
            {...entries[2], id: 2},
        ])
    })
})
