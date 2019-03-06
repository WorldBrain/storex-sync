import * as expect from 'expect'
import StorageManager from '@worldbrain/storex'
import { DexieStorageBackend } from '@worldbrain/storex-backend-dexie'
import inMemory from '@worldbrain/storex-backend-dexie/lib/in-memory'
import { registerModuleCollections } from '@worldbrain/storex-pattern-modules';
import { ClientSyncLogStorage } from './';
import { ClientSyncLogEntry } from './types';

const TEST_LOG_ENTRIES : ClientSyncLogEntry[] = [
    {
        createdOn: 2,
        sharedOn: null,
        needsIntegration: false,
        collection: 'user',
        pk: '1:1',
        operation: 'create',
        value: { displayName: 'Joe' },
    },
    {
        createdOn: 3,
        sharedOn: null,
        needsIntegration: false,
        collection: 'user',
        pk: '2:1',
        operation: 'create',
        value: { displayName: 'Joe' },
    },
    {
        createdOn: 4,
        sharedOn: null,
        needsIntegration: false,
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

    it('should mark entries as synced', async () => {
        const { syncLogStorage } = await setupTest()

        await syncLogStorage.insertEntries([TEST_LOG_ENTRIES[0], TEST_LOG_ENTRIES[1], TEST_LOG_ENTRIES[2]])
        await syncLogStorage.updateSharedUntil({until: 3, sharedOn: 6})

        expect(await syncLogStorage.getEntriesCreatedAfter(2)).toEqual([
            {...TEST_LOG_ENTRIES[0], id: 1, sharedOn: 6},
            {...TEST_LOG_ENTRIES[1], id: 2, sharedOn: 6},
            {...TEST_LOG_ENTRIES[2], id: 3},
        ])
    })

    it('should retrieve unshared entries in order of createdOn', async () => {
        const { syncLogStorage } = await setupTest()

        await syncLogStorage.insertEntries([TEST_LOG_ENTRIES[0], TEST_LOG_ENTRIES[2]])
        await syncLogStorage.insertEntries([TEST_LOG_ENTRIES[1]])
        await syncLogStorage.updateSharedUntil({until: 2, sharedOn: 6})

        expect(await syncLogStorage.getUnsharedEntries()).toEqual([
            {...TEST_LOG_ENTRIES[1], id: 3},
            {...TEST_LOG_ENTRIES[2], id: 2},
        ])
    })

    it('should be able to insert entries received from shared log', async () => {
        const { syncLogStorage } = await setupTest()
        const now = 56
        await syncLogStorage.insertReceivedEntries(TEST_LOG_ENTRIES.slice(0, 1).map(entry => ({
            userId: 'test-user-1',
            deviceId: 'u1d1',
            createdOn: entry.createdOn,
            sharedOn: now - 10,
            data: JSON.stringify({
                collection: entry.collection,
                pk: entry.pk,
                operation: entry.operation,
                value: entry['value'],
            })
        })), {now})
        expect(await syncLogStorage.getEntriesCreatedAfter(1)).toEqual([
            {
                id: 1,
                createdOn: 2,
                sharedOn: now,
                needsIntegration: true,
                collection: 'user',
                pk: '1:1',
                field: undefined,
                operation: 'create',
                value: { displayName: 'Joe' },
            }
        ])
    })

    it('should be able to mark entries as integrated', async () => {
        const { syncLogStorage } = await setupTest()
        const entries : ClientSyncLogEntry[] = [
            {
                createdOn: 2, sharedOn: 10,
                needsIntegration: true,
                operation: 'create',
                collection: 'user', pk: '1:1',
                value: { displayName: 'Joe' },
            },
            {
                createdOn: 2, sharedOn: 10,
                needsIntegration: true,
                operation: 'create',
                collection: 'user', pk: '1:2',
                value: { displayName: 'Joe' },
            },
        ]

        await syncLogStorage.insertEntries(entries)
        await syncLogStorage.markAsIntegrated(await syncLogStorage.getEntriesCreatedAfter(1))
        expect(await syncLogStorage.getEntriesCreatedAfter(1)).toEqual([
            {...entries[0], id: 1, needsIntegration: false},
            {...entries[1], id: 2, needsIntegration: false},
        ])
    })

    describe('getNextEntriesToIntgrate()', () => {
        it('should be able to get all relevant operations that happened to a single object', async () => {
            const { syncLogStorage } = await setupTest()
            const entries : ClientSyncLogEntry[] = [
                {
                    createdOn: 2, sharedOn: 10,
                    needsIntegration: true,
                    operation: 'create',
                    collection: 'user', pk: '1:1',
                    value: { displayName: 'Joe' },
                },
                {
                    createdOn: 2, sharedOn: 10,
                    needsIntegration: true,
                    operation: 'create',
                    collection: 'user', pk: '1:2',
                    value: { displayName: 'Joe' },
                },
                {
                    createdOn: 3, sharedOn: 10,
                    needsIntegration: true,
                    operation: 'modify',
                    collection: 'user', pk: '1:1', field: 'displayName',
                    value: 'Jack',
                },
                {
                    createdOn: 4, sharedOn: 10,
                    needsIntegration: true,
                    operation: 'delete',
                    collection: 'user', pk: '1:1',
                },
            ]

            await syncLogStorage.insertEntries(entries)
            const firstEntries = await syncLogStorage.getNextEntriesToIntgrate()
            expect(firstEntries).toEqual([
                {id: 1, ...entries[0]},
                {id: 3, ...entries[2]},
                {id: 4, ...entries[3]},
            ])

            await syncLogStorage.markAsIntegrated(firstEntries)
            const secondEntries = await syncLogStorage.getNextEntriesToIntgrate()
            expect(secondEntries).toEqual([
                {id: 2, ...entries[1]},
            ])

            await syncLogStorage.markAsIntegrated(secondEntries)
            const thirdEntries = await syncLogStorage.getNextEntriesToIntgrate()
            expect(thirdEntries).toEqual(null)
        })
    })
})
