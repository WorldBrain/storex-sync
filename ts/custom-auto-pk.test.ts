import * as expect from 'expect'
import StorageManager from '@worldbrain/storex'
import { DexieStorageBackend } from '@worldbrain/storex-backend-dexie'
import inMemory from '@worldbrain/storex-backend-dexie/lib/in-memory'
import { CustomAutoPkMiddleware } from './custom-auto-pk';

describe('CustomAutoPkMiddleware', () => {
    async function setupTest(options : {pkGenerator : () => string}) {
        const backend = new DexieStorageBackend({idbImplementation: inMemory(), dbName: 'unittest'})
        const storageManager = new StorageManager({backend: backend as any})
        storageManager.registry.registerCollections({
            user: {
                version: new Date('2019-01-01'),
                fields: {
                    displayName: { type: 'string' }
                }
            },
            email: {
                version: new Date('2019-01-01'),
                fields: {
                    address: { type: 'string' },
                },
                relationships: [
                    { childOf: 'user' }
                ]
            }
        })
        const customPkMiddleware = new CustomAutoPkMiddleware(options)
        customPkMiddleware.setup({storageRegistry: storageManager.registry, collections: ['user', 'email']})
        storageManager.setMiddleware([customPkMiddleware])
        await storageManager.finishInitialization()
        return { storageManager }
    }

    it('should be able to set custom auto PKs on simple createObject operations', async () => {
        const { storageManager } = await setupTest({pkGenerator: () => 'some-pk'})
        const { object } = await storageManager.collection('user').createObject({ displayName: 'Joe' })
        expect(object.id).toEqual('some-pk')
        expect(await storageManager.collection('user').findOneObject({ id: object.id })).toEqual(object)
    })

    it('should be able to set custom auto PKs on complex createObject operations', async () => {
        let counter = 0
        const { storageManager } = await setupTest({pkGenerator: () => `some-pk-${++counter}`})
        const { object: user } = await storageManager.collection('user').createObject({ displayName: 'Joe', emails: [{address: 'foo@bla.com'}] })
        expect(user).toEqual({
            id: 'some-pk-1',
            displayName: 'Joe',
            emails: [expect.objectContaining({id: 'some-pk-2'})]
        })
        const email = user.emails[0]
        expect(await storageManager.collection('user').findOneObject({ id: user.id })).toEqual({id: user.id, displayName: 'Joe'})
        expect(await storageManager.collection('email').findOneObject({ id: email.id })).toEqual({id: email.id, user: user.id, address: 'foo@bla.com'})
    })
    
    it('should be able to set custom auto PKs on batches')

    it('should be able to migrate from normal to custom auto PKs')
})
