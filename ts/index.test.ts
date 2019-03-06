import * as expect from 'expect'
import { setupStorexTest } from '@worldbrain/storex-pattern-modules/lib/index.tests'
import { SharedSyncLogStorage } from './shared-sync-log';
import { ClientSyncLogStorage } from './client-sync-log';
import { CustomAutoPkMiddleware } from './custom-auto-pk';
import { SyncLoggingMiddleware } from './logging-middleware';
import { shareLogEntries, receiveLogEntries, doSync } from '.';
import { reconcileSyncLog } from './reconciliation';

type PromiseContentType<T> = T extends Promise<infer U> ? U : T

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

    function createGetNow(options : {start : number}) {
        let now = options.start
        return () => now++
    }

    async function setupClient(options : {backend, clientName : string, getNow : () => number, pkGenerator : () => string}) {
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

        const syncLoggingMiddleware = new SyncLoggingMiddleware({ storageManager, clientSyncLog: modules.clientSyncLog })
        syncLoggingMiddleware._getNow = options.getNow

        storageManager.setMiddleware([
            pkMiddleware,
            syncLoggingMiddleware
        ])

        return { storageManager, modules, deviceId: null, objects: {} }
    }

    async function setupTest(options : {clients? : {name : string}[], getNow : () => number}) {
        let idsGenerated = 0
        const pkGenerator = () => `id-${++idsGenerated}`

        const userId = 1
        const backend = await setupBackend({})

        const clients : {[name : string] : PromiseContentType<ReturnType<typeof setupClient>>} = {}
        for (const { name } of options.clients || []) {
            clients[name] = await setupClient({backend, clientName: name, getNow: options.getNow, pkGenerator})
            clients[name].deviceId = await backend.modules.sharedSyncLog.createDeviceId({ userId, sharedUntil: 10 })
        }

        return { backend, clients, userId }
    }

    describe('shareLogEntries()', () => {
        async function setupShareTest() {
            const { backend, clients, userId } = await setupTest({clients: [{ name: 'one' }, { name: 'two' } ], getNow: createGetNow({start: 2})})
            await clients.one.storageManager.collection('user').createObject({displayName: 'Joe', emails: [{address: 'joe@doe.com'}]})
            
            const share = (options : {now: number}) => shareLogEntries({
                sharedSyncLog: backend.modules.sharedSyncLog, clientSyncLog: clients.one.modules.clientSyncLog,
                userId, deviceId: clients.one.deviceId, now: options.now
            })

            return { backend, clients, userId, share }
        }

        it('should correctly share log entries', async () => {
            const { backend, clients, userId, share } = await setupShareTest()

            await share({now: 55})
            expect(await backend.modules.sharedSyncLog.getUnsyncedEntries({deviceId: clients.two.deviceId})).toEqual([
                {
                    id: expect.anything(),
                    userId,
                    deviceId: clients.one.deviceId,
                    createdOn: 2,
                    sharedOn: 55,
                    data: '{"operation":"create","collection":"user","pk":"id-1","field":null,"value":{"displayName":"Joe"}}',
                },
                {
                    id: expect.anything(),
                    userId,
                    deviceId: clients.one.deviceId,
                    createdOn: 3,
                    sharedOn: 55,
                    data: '{"operation":"create","collection":"email","pk":"id-2","field":null,"value":{"address":"joe@doe.com"}}',
                },
            ])
        })

        it('should not reshare entries that are already shared', async () => {
            const { backend, clients, share } = await setupShareTest()

            await share({now: 55})
            const entries = await backend.modules.sharedSyncLog.getUnsyncedEntries({deviceId: clients.two.deviceId})
            await share({now: 60})
            expect(await backend.modules.sharedSyncLog.getUnsyncedEntries({deviceId: clients.two.deviceId})).toEqual(entries)
        })
    })

    describe('receiveLogEntries()', () => {
        async function setupReceiveTest() {
            const { backend, clients, userId } = await setupTest({clients: [{ name: 'one' }, { name: 'two' } ], getNow: createGetNow({start: 2})})
            const receive = async (options : {now : number}) => {
                await receiveLogEntries({
                    clientSyncLog: clients.one.modules.clientSyncLog,
                    sharedSyncLog: backend.modules.sharedSyncLog,
                    deviceId: clients.one.deviceId,
                    now: options.now,
                })
            }
            return { backend, clients, userId, receive }
        }

        it('should correctly receive unsynced entries and write them to the local log marked as needing integration', async () => {
            const { backend, clients, userId, receive } = await setupReceiveTest()
            await clients.one.storageManager.collection('user').createObject({displayName: 'Bob'})

            await backend.modules.sharedSyncLog.writeEntries([
                {
                    userId,
                    deviceId: clients.one.deviceId,
                    createdOn: 5,
                    sharedOn: 55,
                    data: '{"operation":"create","collection":"user","pk":"id-2","field":null,"value":{"displayName":"Joe"}}',
                },
                {
                    userId,
                    deviceId: clients.one.deviceId,
                    createdOn: 7,
                    sharedOn: 55,
                    data: '{"operation":"create","collection":"email","pk":"id-3","field":null,"value":{"address":"joe@doe.com"}}',
                },
            ], { userId, deviceId: clients.one.deviceId })
            
            await receive({now: 60})
            expect(await clients.one.modules.clientSyncLog.getEntriesCreatedAfter(1)).toEqual([
                {
                    id: expect.anything(),
                    createdOn: 2,
                    sharedOn: null,
                    needsIntegration: false,
                    collection: 'user',
                    pk: 'id-1',
                    operation: 'create',
                    value: { displayName: 'Bob' },
                },
                {
                    id: expect.anything(),
                    createdOn: 5,
                    sharedOn: 60,
                    needsIntegration: true,
                    collection: 'user',
                    pk: 'id-2',
                    field: null,
                    operation: 'create',
                    value: { displayName: 'Joe' },
                },
                {
                    id: expect.anything(),
                    createdOn: 7,
                    sharedOn: 60,
                    needsIntegration: true,
                    collection: 'email',
                    pk: 'id-3',
                    field: null,
                    operation: 'create',
                    value: { address: 'joe@doe.com' },
                }
            ])
        })
    })

    describe('doSync()', () => {
        async function setupSyncTest() {
            const { backend, clients, userId } = await setupTest({ clients: [{ name: 'one' }, { name: 'two' }], getNow: createGetNow({ start: 50 }) })
            const sync = async (options : {clientName : string, now : number}) => {
                const client = clients[options.clientName]
                await doSync({
                    clientSyncLog: client.modules.clientSyncLog,
                    sharedSyncLog: backend.modules.sharedSyncLog,
                    storageManager: client.storageManager,
                    reconciler: reconcileSyncLog,
                    now: options.now,
                    userId,
                    deviceId: client.deviceId
                })
            }
            return { clients, sync }
        }

        it('should work when pulling changes after being offline', async () => {
            const { clients, sync } = await setupSyncTest()
            clients.one.objects['1'] = (await clients.one.storageManager.collection('user').createObject({displayName: 'Joe', emails: [{address: 'joe@doe.com'}]})).object
            await sync({clientName: 'one', now: 55})
            // await sync({clientName: 'two', now: 60})
            // clients.two.objects['1'] = await clients.two.storageManager.collection('user').findObject({id: clients.one.objects['1'].id})
            // expect(clients.two.objects['1']).toEqual(clients.one.objects['1'])
        })
    })
})
