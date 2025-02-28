import StorageManager, { StorageBackend } from '@worldbrain/storex'
import { RegistryCollections } from '@worldbrain/storex/lib/registry'
import { DexieStorageBackend } from '@worldbrain/storex-backend-dexie'
import inMemory from '@worldbrain/storex-backend-dexie/lib/in-memory'
import { ClientSyncLogStorage } from './client-sync-log'
import { registerModuleMapCollections } from '@worldbrain/storex-pattern-modules'
import { CustomAutoPkMiddleware } from './custom-auto-pk'
import { SyncLoggingMiddleware } from './logging-middleware'
import { StorageMiddleware } from '@worldbrain/storex/lib/types/middleware'

export type TestDependencyInjector<
    TestDependencies,
    TestRunnerOptions = never
> = (
    body: (dependencies: TestDependencies) => Promise<void>,
    options?: TestRunnerOptions,
) => Promise<void>

export function makeTestFactory<TestDependencies, TestRunnerOptions = never>(
    withTestDependencies: TestDependencyInjector<
        TestDependencies,
        TestRunnerOptions
    >,
) {
    type TestFunction = (dependencies: TestDependencies) => Promise<void>

    return async function wrappedIt(
        description: string,
        test: TestFunction,
        options?: TestRunnerOptions,
    ) {
        it(description, async () => {
            await withTestDependencies(
                async (dependencies: TestDependencies) => {
                    await test(dependencies)
                },
                options,
            )
        })
    }
}

export async function setupSyncTestClient(options: {
    getNow: () => number | '$now'
    createClientStorageBackend?: () => StorageBackend
    withModificationMerging?: boolean
    pkGenerator?: () => string
    collections?: RegistryCollections
    dontFinishInitialization?: boolean
    withCompoundPks?: boolean
}) {
    const backend = options.createClientStorageBackend
        ? options.createClientStorageBackend()
        : ((new DexieStorageBackend({
              dbName: 'test',
              idbImplementation: inMemory(),
          }) as any) as StorageBackend)
    const storageManager = new StorageManager({ backend })
    storageManager.registry.registerCollections(
        options.collections || {
            user: {
                version: new Date('2019-01-01'),
                fields: options.withCompoundPks
                    ? {
                          firstName: { type: 'string' },
                          lastName: { type: 'string' },
                          test: { type: 'string', optional: true },
                      }
                    : { displayName: { type: 'string' } },
                indices: options.withCompoundPks
                    ? [
                          { field: ['firstName', 'lastName'], pk: true },
                          { field: 'lastName' },
                      ]
                    : undefined,
            },
            email: {
                version: new Date('2019-01-01'),
                fields: {
                    address: { type: 'string' },
                },
                relationships: options.withCompoundPks
                    ? []
                    : [{ childOf: 'user' }],
            },
        },
    )
    const clientSyncLog = new ClientSyncLogStorage({ storageManager })
    registerModuleMapCollections(storageManager.registry, { clientSyncLog })

    const includeCollections = options.collections
        ? Object.keys(options.collections)
        : ['user', 'email']

    const middleware: StorageMiddleware[] = []
    if (
        options.pkGenerator &&
        (options.collections || !options.withCompoundPks)
    ) {
        const pkMiddleware = new CustomAutoPkMiddleware({
            pkGenerator: options.pkGenerator,
        })
        pkMiddleware.setup({
            storageRegistry: storageManager.registry,
            collections: includeCollections,
        })
        middleware.push(pkMiddleware)
    }

    const syncLoggingMiddleware = new SyncLoggingMiddleware({
        storageManager,
        clientSyncLog,
        includeCollections,
        mergeModifications: options.withModificationMerging,
    })
    syncLoggingMiddleware._getNow = async () => options.getNow()
    middleware.push(syncLoggingMiddleware)

    storageManager.setMiddleware(middleware)

    const deviceId: number | string = null as any

    if (!options.dontFinishInitialization) {
        await storageManager.finishInitialization()
        await storageManager.backend.migrate()
    }

    return {
        storageManager,
        syncLoggingMiddleware,
        clientSyncLog,
        deviceId,
        objects: {},
    }
}

export function linearTimestampGenerator(options: {
    start: number
    step?: number
}) {
    let now = options.start
    return () => {
        const oldNow = now
        now += options.step || 1
        return oldNow
    }
}
