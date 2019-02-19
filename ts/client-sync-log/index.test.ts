import * as expect from 'expect'
import StorageManager from '@worldbrain/storex'
import { DexieStorageBackend } from '@worldbrain/storex-backend-dexie'
import inMemory from '@worldbrain/storex-backend-dexie/lib/in-memory'
import { ClientSyncLogStorage } from './';
import { registerModuleCollections } from '@worldbrain/storex-pattern-modules';
import { ClientSyncLogEntry } from './types';

const TEST_LOG_ENTRIES : ClientSyncLogEntry[] = [
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

async function setupTest() {
    const backend = new DexieStorageBackend({idbImplementation: inMemory(), dbName: 'unittest'})
    const storageManager = new StorageManager({backend: backend as any})
    const syncLogStorage = new ClientSyncLogStorage({storageManager})
    registerModuleCollections(storageManager.registry, syncLogStorage)
    await storageManager.finishInitialization()
    return { syncLogStorage }
}

describe('Client sync log', () => {
    it('should store and retrieve entries correctly', async () => {
        const { syncLogStorage } = await setupTest()

        await syncLogStorage.insertEntries([TEST_LOG_ENTRIES[0], TEST_LOG_ENTRIES[2]])

        expect(await syncLogStorage.getEntriesCreatedAfter(2)).toEqual([
            {...TEST_LOG_ENTRIES[0], id: 1},
            {...TEST_LOG_ENTRIES[2], id: 2},
        ])
        expect(await syncLogStorage.getEntriesCreatedAfter(3)).toEqual([
            {...TEST_LOG_ENTRIES[2], id: 2},
        ])
    })

    it('should store and retrieve entries received out-of-order correctly', async () => {
        const { syncLogStorage } = await setupTest()

        await syncLogStorage.insertEntries([TEST_LOG_ENTRIES[0], TEST_LOG_ENTRIES[2]])
        await syncLogStorage.insertEntries([TEST_LOG_ENTRIES[1]])

        expect(await syncLogStorage.getEntriesCreatedAfter(2)).toEqual([
            {...TEST_LOG_ENTRIES[0], id: 1},
            {...TEST_LOG_ENTRIES[1], id: 3},
            {...TEST_LOG_ENTRIES[2], id: 2},
        ])
    })

    it('should mark entries as synched', async () => {
        const { syncLogStorage } = await setupTest()

        await syncLogStorage.insertEntries([TEST_LOG_ENTRIES[0], TEST_LOG_ENTRIES[1], TEST_LOG_ENTRIES[2]])
        await syncLogStorage.updateSyncedUntil({until: 3, syncedOn: 6})

        expect(await syncLogStorage.getEntriesCreatedAfter(2)).toEqual([
            {...TEST_LOG_ENTRIES[0], id: 1, syncedOn: 6},
            {...TEST_LOG_ENTRIES[1], id: 2, syncedOn: 6},
            {...TEST_LOG_ENTRIES[2], id: 3},
        ])
    })

    it('should retrieve unsynced entries in order of createdOn', async () => {
        const { syncLogStorage } = await setupTest()

        await syncLogStorage.insertEntries([TEST_LOG_ENTRIES[0], TEST_LOG_ENTRIES[2]])
        await syncLogStorage.insertEntries([TEST_LOG_ENTRIES[1]])
        await syncLogStorage.updateSyncedUntil({until: 2, syncedOn: 6})

        expect(await syncLogStorage.getUnsyncedEntries()).toEqual([
            {...TEST_LOG_ENTRIES[1], id: 3},
            {...TEST_LOG_ENTRIES[2], id: 2},
        ])
    })
})
