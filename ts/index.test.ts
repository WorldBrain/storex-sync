import { setupStorexTest } from '@worldbrain/storex-pattern-modules/lib/index.tests'
import { SharedSyncLogStorage } from './shared-sync-log';
import { ClientSyncLogStorage } from './client-sync-log';
import { CustomAutoPkMiddleware } from './custom-auto-pk';
import { SyncLoggingMiddleware } from './logging-middleware';

describe('Storex sync integration tests', () => {
    async function setupBackend(options) {
        return setupStorexTest<{sharedSyncLog : SharedSyncLogStorage}>({
            collections: {},
            modules: {
                sharedSyncLog: ({storageManager}) => new SharedSyncLogStorage({storageManager})
            }
        })
    }

    async function setupClient(options : {backend, pkGenerator : () => string}) {
        const { storageManager, modules } = await setupStorexTest<{clientSyncLog : ClientSyncLogStorage}>({
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
        storageManager.setMiddleware([
            new CustomAutoPkMiddleware({pkGenerator: options.pkGenerator}),
            new SyncLoggingMiddleware({storageManager, clientSyncLog: modules.clientSyncLog})
        ])

        const sync = async () => {
            
        }

        return { storageManager, modules, sync, objects: {} }
    }

    it('should work when pulling changes after being offline', async () => {
        // let idsGenerated = 0
        // const pkGenerator = () => `id-${++idsGenerated}`

        // const backend = await setupBackend({})
        // const client1 = await setupClient({backend, pkGenerator})
        // client1.objects['1'] = await client1.storageManager.collection('user').createObject({displayName: 'Joe', emails: [{address: 'joe@doe.com'}]})
        // await client1.sync()
        // const client2 = await setupClient({backend, pkGenerator})
        // await client2.sync()
        // client2.objects['1'] = await client2.storageManager.collection('user').createObject({displayName: 'Joe', emails: [{address: 'joe@doe.com'}]})
    })
})
