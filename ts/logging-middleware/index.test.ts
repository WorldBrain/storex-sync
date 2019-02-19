import * as expect from 'expect'
import StorageManager, { CollectionFields } from '@worldbrain/storex'
import { DexieStorageBackend } from '@worldbrain/storex-backend-dexie'
import inMemory from '@worldbrain/storex-backend-dexie/lib/in-memory'
import { registerModuleCollections } from '@worldbrain/storex-pattern-modules';
import { ClientSyncLogStorage } from '../client-sync-log';
import { SyncLoggingMiddleware } from '.';


async function setupTest({now, userFields} : {now : () => number, userFields? : CollectionFields}) {
    const backend = new DexieStorageBackend({idbImplementation: inMemory(), dbName: 'unittest'})
    const storageManager = new StorageManager({backend: backend as any})
    storageManager.registry.registerCollections({
        user: {
            version: new Date('2019-02-19'),
            fields: userFields || {
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
    it('should write createObject operations to the ClientSyncLog in a batch write', async () => {
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

    it('should write updateObject operations done by pk on a single field to the ClientSyncLog in a batch write', async () => {
        let now = 2
        const { storageManager, clientSyncLog } = await setupTest({now: () => ++now})
        await storageManager.collection('user').createObject({id: 53, displayName: 'John Doe'})
        await storageManager.collection('user').updateOneObject({id: 53}, {displayName: 'Jack Doe'})
        expect(await clientSyncLog.getEntriesCreatedAfter(1)).toEqual([
            {
                id: expect.anything(),
                createdOn: 3,
                collection: 'user', pk: 53,
                operation: 'create', value: {displayName: 'John Doe'}
            },
            {
                id: expect.anything(),
                createdOn: 4,
                collection: 'user', pk: 53,
                operation: 'modify', field: 'displayName',
                value: 'Jack Doe',
            },
        ])
    })

    it('should write updateObject operations done by pk on multiple fields to the ClientSyncLog in a batch write', async () => {
        let now = 2
        const { storageManager, clientSyncLog } = await setupTest({now: () => ++now, userFields: {
            firstName: {type: 'string'},
            lastName: {type: 'string'},
        }})
        await storageManager.collection('user').createObject({id: 53, firstName: 'John', lastName: 'Doe'})
        await storageManager.collection('user').updateOneObject({id: 53}, {firstName: 'Jack', lastName: 'Trump'})
        expect(await clientSyncLog.getEntriesCreatedAfter(1)).toEqual([
            {
                id: expect.anything(),
                createdOn: 3,
                collection: 'user', pk: 53,
                operation: 'create', value: {firstName: 'John', lastName: 'Doe'}
            },
            {
                id: expect.anything(),
                createdOn: 4,
                collection: 'user', pk: 53,
                operation: 'modify', field: 'firstName',
                value: 'Jack',
            },
            {
                id: expect.anything(),
                createdOn: 5,
                collection: 'user', pk: 53,
                operation: 'modify', field: 'lastName',
                value: 'Trump',
            },
        ])
    })

    it('should write updateObjects operations done on a single field to the ClientSyncLog in a batch write', async () => {
        let now = 2
        const { storageManager, clientSyncLog } = await setupTest({now: () => ++now, userFields: {
            firstName: {type: 'string'},
            lastName: {type: 'string'},
        }})
        await storageManager.collection('user').createObject({id: 53, firstName: 'John', lastName: 'Doe'})
        await storageManager.collection('user').createObject({id: 54, firstName: 'Jane', lastName: 'Doe'})
        await storageManager.collection('user').updateObjects({firstName: 'John'}, {lastName: 'Trump'})
        expect(await clientSyncLog.getEntriesCreatedAfter(1)).toEqual([
            {
                id: expect.anything(),
                createdOn: 3,
                collection: 'user', pk: 53,
                operation: 'create', value: {firstName: 'John', lastName: 'Doe'}
            },
            {
                id: expect.anything(),
                createdOn: 4,
                collection: 'user', pk: 54,
                operation: 'create', value: {firstName: 'Jane', lastName: 'Doe'}
            },
            {
                id: expect.anything(),
                createdOn: 5,
                collection: 'user', pk: 53,
                operation: 'modify', field: 'lastName',
                value: 'Trump',
            },
            {
                id: expect.anything(),
                createdOn: 6,
                collection: 'user', pk: 54,
                operation: 'modify', field: 'lastName',
                value: 'Trump',
            },
        ])
    })
    
    it('should write updateObject operations done on multiple fields to the ClientSyncLog in a batch write')
})
