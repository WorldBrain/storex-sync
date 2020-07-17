import expect from 'expect'
import StorageManager, { StorageBackend } from '@worldbrain/storex'
import { DexieStorageBackend } from '@worldbrain/storex-backend-dexie'
import inMemory from '@worldbrain/storex-backend-dexie/lib/in-memory'
import { registerModuleCollections } from '@worldbrain/storex-pattern-modules'
import { ClientSyncLogStorage } from './'
import { ClientSyncLogEntry } from './types'
import { TypeORMStorageBackend } from '@worldbrain/storex-backend-typeorm'

const TEST_LOG_ENTRIES: ClientSyncLogEntry[] = [
    {
        deviceId: 'device-one',
        createdOn: 2,
        sharedOn: 0,
        needsIntegration: 0,
        collection: 'user',
        pk: '1:1',
        operation: 'create',
        value: { displayName: 'Joe' },
    },
    {
        deviceId: 'device-one',
        createdOn: 3,
        sharedOn: 0,
        needsIntegration: 0,
        collection: 'user',
        pk: '2:1',
        operation: 'create',
        value: { displayName: 'Joe' },
    },
    {
        deviceId: 'device-one',
        createdOn: 4,
        sharedOn: 0,
        needsIntegration: 0,
        collection: 'user',
        pk: '1:2',
        operation: 'create',
        value: { displayName: 'Joe' },
    },
]

interface TestDependencies {
    createBackend(): StorageBackend
    destroyBackend?(backend: StorageBackend): Promise<void>
}
interface TestSetup {
    syncLogStorage: ClientSyncLogStorage
}

async function setupTest(backend: StorageBackend): Promise<TestSetup> {
    const storageManager = new StorageManager({ backend: backend as any })
    const syncLogStorage = new ClientSyncLogStorage({ storageManager })
    registerModuleCollections(storageManager.registry, syncLogStorage)
    await storageManager.finishInitialization()
    await backend.migrate()
    return { syncLogStorage }
}

function makeTestFactory(dependencies: TestDependencies) {
    return (description: string, test: (setup: TestSetup) => Promise<void>) => {
        it(description, async () => {
            const backend = dependencies.createBackend()
            try {
                const setup = await setupTest(backend)
                await test(setup)
            } finally {
                if (dependencies.destroyBackend) {
                    await dependencies.destroyBackend(backend)
                }
            }
        })
    }
}

function clientSyncLogTests(dependencies: TestDependencies) {
    const it = makeTestFactory(dependencies)

    it('should store and retrieve entries correctly', async ({
        syncLogStorage,
    }) => {
        await syncLogStorage.insertEntries([
            TEST_LOG_ENTRIES[0],
            TEST_LOG_ENTRIES[2],
        ])

        expect(await syncLogStorage.getEntriesCreatedAfter(2)).toEqual([
            { ...TEST_LOG_ENTRIES[0] },
            { ...TEST_LOG_ENTRIES[2] },
        ])
        expect(await syncLogStorage.getEntriesCreatedAfter(3)).toEqual([
            { ...TEST_LOG_ENTRIES[2] },
        ])
    })

    it('should store and retrieve entries received out-of-order correctly', async ({
        syncLogStorage,
    }) => {
        await syncLogStorage.insertEntries([
            TEST_LOG_ENTRIES[0],
            TEST_LOG_ENTRIES[2],
        ])
        await syncLogStorage.insertEntries([TEST_LOG_ENTRIES[1]])

        expect(await syncLogStorage.getEntriesCreatedAfter(2)).toEqual([
            { ...TEST_LOG_ENTRIES[0] },
            { ...TEST_LOG_ENTRIES[1] },
            { ...TEST_LOG_ENTRIES[2] },
        ])
    })

    it('should mark entries as synced', async ({ syncLogStorage }) => {
        await syncLogStorage.insertEntries([
            TEST_LOG_ENTRIES[0],
            TEST_LOG_ENTRIES[1],
            TEST_LOG_ENTRIES[2],
        ])
        await syncLogStorage.updateSharedUntil({ until: 3, sharedOn: 6 })

        expect(await syncLogStorage.getEntriesCreatedAfter(2)).toEqual([
            { ...TEST_LOG_ENTRIES[0], sharedOn: 6 },
            { ...TEST_LOG_ENTRIES[1], sharedOn: 6 },
            { ...TEST_LOG_ENTRIES[2] },
        ])
    })

    it('should retrieve unshared entries in order of createdOn', async ({
        syncLogStorage,
    }) => {
        await syncLogStorage.insertEntries([
            TEST_LOG_ENTRIES[0],
            TEST_LOG_ENTRIES[2],
        ])
        await syncLogStorage.insertEntries([TEST_LOG_ENTRIES[1]])
        await syncLogStorage.updateSharedUntil({ until: 2, sharedOn: 6 })

        expect(await syncLogStorage.getUnsharedEntries()).toEqual([
            { ...TEST_LOG_ENTRIES[1] },
            { ...TEST_LOG_ENTRIES[2] },
        ])
    })

    it('should be able to insert entries received from shared log', async ({
        syncLogStorage,
    }) => {
        const now = 56
        await syncLogStorage.insertReceivedEntries(
            TEST_LOG_ENTRIES.slice(0, 1).map(entry => ({
                userId: 'test-user-1',
                deviceId: 'u1d1',
                createdOn: entry.createdOn,
                sharedOn: now - 10,
                data: {
                    operation: entry.operation,
                    collection: entry.collection,
                    pk: entry.pk,
                    field: null,
                    value: entry['value'],
                },
            })),
            { now },
        )
        expect(await syncLogStorage.getEntriesCreatedAfter(1)).toEqual([
            {
                createdOn: 2,
                deviceId: 'u1d1',
                sharedOn: now,
                needsIntegration: 1,
                collection: 'user',
                pk: '1:1',
                field: undefined,
                operation: 'create',
                value: { displayName: 'Joe' },
            },
        ])
    })

    it('should be able to mark entries as integrated', async ({
        syncLogStorage,
    }) => {
        const entries: ClientSyncLogEntry[] = [
            {
                deviceId: 'device-one',
                createdOn: 2,
                sharedOn: 10,
                needsIntegration: 1,
                operation: 'create',
                collection: 'user',
                pk: '1:1',
                value: { displayName: 'Joe' },
            },
            {
                deviceId: 'device-one',
                createdOn: 3,
                sharedOn: 10,
                needsIntegration: 1,
                operation: 'create',
                collection: 'user',
                pk: '1:2',
                value: { displayName: 'Joe' },
            },
        ]

        await syncLogStorage.insertEntries(entries)
        await syncLogStorage.markAsIntegrated(
            await syncLogStorage.getEntriesCreatedAfter(1),
        )
        expect(await syncLogStorage.getEntriesCreatedAfter(1)).toEqual([
            { ...entries[0], needsIntegration: 0 },
            { ...entries[1], needsIntegration: 0 },
        ])
    })

    describe('getNextEntriesToIntgrate()', () => {
        it('should be able to get all relevant operations that happened to a single object', async ({
            syncLogStorage,
        }) => {
            const entries: ClientSyncLogEntry[] = [
                {
                    deviceId: 'device-one',
                    createdOn: 2,
                    sharedOn: 10,
                    needsIntegration: 1,
                    operation: 'create',
                    collection: 'user',
                    pk: '1:1',
                    value: { displayName: 'Joe' },
                },
                {
                    deviceId: 'device-one',
                    createdOn: 3,
                    sharedOn: 10,
                    needsIntegration: 1,
                    operation: 'create',
                    collection: 'user',
                    pk: '1:2',
                    value: { displayName: 'Joe' },
                },
                {
                    deviceId: 'device-one',
                    createdOn: 4,
                    sharedOn: 10,
                    needsIntegration: 1,
                    operation: 'modify',
                    collection: 'user',
                    pk: '1:1',
                    field: 'displayName',
                    value: 'Jack',
                },
                {
                    deviceId: 'device-one',
                    createdOn: 5,
                    sharedOn: 10,
                    needsIntegration: 1,
                    operation: 'delete',
                    collection: 'user',
                    pk: '1:1',
                },
            ]

            await syncLogStorage.insertEntries(entries)
            const firstEntries = (await syncLogStorage.getNextEntriesToIntgrate()) as ClientSyncLogEntry[]
            expect(firstEntries).toEqual([
                { ...entries[0] },
                { ...entries[2] },
                { ...entries[3] },
            ])

            await syncLogStorage.markAsIntegrated(firstEntries)
            const secondEntries = (await syncLogStorage.getNextEntriesToIntgrate()) as ClientSyncLogEntry[]
            expect(secondEntries).toEqual([{ ...entries[1] }])

            await syncLogStorage.markAsIntegrated(secondEntries)
            const thirdEntries = await syncLogStorage.getNextEntriesToIntgrate()
            expect(thirdEntries).toEqual(null)
        })
    })
}

describe('Client sync log with in-memory Dexie IndexedDB backend', () => {
    clientSyncLogTests({
        createBackend: () => {
            return (new DexieStorageBackend({
                idbImplementation: inMemory(),
                dbName: 'unittest',
                legacyMemexCompatibility: true,
            }) as any) as StorageBackend
        },
    })
})

// describe('Client sync log with in-memory TypeORM SQLite backend', () => {
//     clientSyncLogTests({
//         createBackend: () => {
//             return new TypeORMStorageBackend({
//                 connectionOptions: { type: 'sqlite', database: ':memory:' },
//             }) as any as StorageBackend
//         },
//         destroyBackend: async (backend: StorageBackend) => {
//             const connection = (backend as any as TypeORMStorageBackend).connection!
//             if (connection) {
//                 await connection.close()
//             }
//         }
//     })
// })
