import * as expect from 'expect'
import { setupStorexTest } from '@worldbrain/storex-pattern-modules/lib/index.tests'
import { SharedSyncLogStorage } from './shared-sync-log';
import { ClientSyncLogStorage } from './client-sync-log';
import { CustomAutoPkMiddleware } from './custom-auto-pk';
import { SyncLoggingMiddleware } from './logging-middleware';
import { shareLogEntries } from '.';

describe('Storex sync integration tests', () => {
    async function setupBackend(options) {
        return setupStorexTest<{sharedSyncLog : SharedSyncLogStorage}>({
            dbName: 'backend',
            collections: {},
            modules: {
                sharedSyncLog: ({storageManager}) => new SharedSyncLogStorage({storageManager})
            }
        })
    }

    async function setupClient(options : {backend, clientName : string, pkGenerator : () => string}) {
        const { storageManager, modules } = await setupStorexTest<{clientSyncLog : ClientSyncLogStorage}>({
            dbName: `client-${options.clientName}`,
            collections: {
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
            },
            modules: {
                clientSyncLog: ({storageManager}) => new ClientSyncLogStorage({storageManager})
            }
        })
        const pkMiddleware = new CustomAutoPkMiddleware({ pkGenerator: options.pkGenerator })
        pkMiddleware.setup({ storageRegistry: storageManager.registry, collections: ['user', 'email'] })
        storageManager.setMiddleware([
            pkMiddleware,
            new SyncLoggingMiddleware({storageManager, clientSyncLog: modules.clientSyncLog})
        ])

        const sync = async () => {
            
        }

        return { storageManager, modules, sync, objects: {} }
    }

    describe('shareLogEntries()', () => {
        it('should correctly share log entries', async () => {
            let idsGenerated = 0
            const pkGenerator = () => `id-${++idsGenerated}`
    
            const backend = await setupBackend({})
            const client1 = await setupClient({backend, clientName: 'one', pkGenerator})
            client1.objects['1'] = (await client1.storageManager.collection('user').createObject({displayName: 'Joe', emails: [{address: 'joe@doe.com'}]})).object
            // console.log(await client1.modules.clientSyncLog.getEntriesCreatedAfter(1))

            const userId = 1
            const device1 = await backend.modules.sharedSyncLog.createDeviceId({ userId, sharedUntil: 10 })
            const device2 = await backend.modules.sharedSyncLog.createDeviceId({ userId, sharedUntil: 10 })
            await shareLogEntries({
                sharedSyncLog: backend.modules.sharedSyncLog, clientSyncLog: client1.modules.clientSyncLog,
                userId: 1, deviceId: device1, now: 55
            })
            expect(await backend.modules.sharedSyncLog.getUnsyncedEntries({deviceId: device2})).toEqual([

            ])
        })
    })

    // it('should work when pulling changes after being offline', async () => {
    //     let idsGenerated = 0
    //     const pkGenerator = () => `id-${++idsGenerated}`

    //     const backend = await setupBackend({})
    //     const client1 = await setupClient({backend, pkGenerator})
    //     client1.objects['1'] = (await client1.storageManager.collection('user').createObject({displayName: 'Joe', emails: [{address: 'joe@doe.com'}]})).object
    //     await client1.sync()
    //     const client2 = await setupClient({backend, pkGenerator})
    //     await client2.sync()
    //     client2.objects['1'] = await client2.storageManager.collection('user').findObject({id: client1.objects['1'].id})
    //     expect(client2.objects['1']).toEqual(client1.objects['1'])
    // })
})
