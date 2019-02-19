import * as expect from 'expect'
import StorageManager from '@worldbrain/storex'
import { DexieStorageBackend } from '@worldbrain/storex-backend-dexie'
import inMemory from '@worldbrain/storex-backend-dexie/lib/in-memory'
import { registerModuleCollections } from '@worldbrain/storex-pattern-modules';
import { ClientSyncLogStorage } from '../client-sync-log';
import { SyncLoggingMiddleware } from '.';


async function setupTest({now} : {now : () => number}) {
    const backend = new DexieStorageBackend({idbImplementation: inMemory(), dbName: 'unittest'})
    const storageManager = new StorageManager({backend: backend as any})
    storageManager.registry.registerCollections({
        user: {
            version: new Date('2019-02-19'),
            fields: {
                displayName: {type: 'string'}
            }
        }
    })
    const clientSyncLog = new ClientSyncLogStorage({storageManager})
    registerModuleCollections(storageManager.registry, clientSyncLog)
    await storageManager.finishInitialization()
    const loggingMiddleware = new SyncLoggingMiddleware({ clientSyncLog, storageManager });
    loggingMiddleware._getNow = now
    storageManager.setMiddleware([loggingMiddleware])
    return { storageManager, clientSyncLog }
}

describe('Sync logging middleware', () => {
    it('should write creations to the ClientSyncLog in a batch write', async () => {
        const { storageManager, clientSyncLog } = await setupTest({now: () => 3})
        await storageManager.collection('user').createObject({id: 53, displayName: 'John Doe'})
        expect(await clientSyncLog.getEntriesCreatedAfter(1)).toEqual([
            {
                id: expect.anything(),
                createdOn: 3,
                collection: 'user', pk: 53,
                operation: 'create', value: {displayName: 'John Doe'}
            },
        ])
    })
})
