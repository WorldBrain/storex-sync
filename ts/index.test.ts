import expect from 'expect'
import * as graphqlModule from 'graphql'
import fromPairs from 'lodash/fromPairs'
import { setupStorexTest } from '@worldbrain/storex-pattern-modules/lib/index.tests'
import { setupTestGraphQLStorexClient } from '@worldbrain/storex-graphql-client/lib/index.tests'
import { withEmulatedFirestoreBackend } from '@worldbrain/storex-backend-firestore/lib/index.tests'
import { SharedSyncLogStorage } from './shared-sync-log/storex';
import { ClientSyncLogStorage } from './client-sync-log';
import { CustomAutoPkMiddleware } from './custom-auto-pk';
import { SyncLoggingMiddleware } from './logging-middleware';
import { shareLogEntries, receiveLogEntries, doSync, SyncSerializer } from '.';
import { reconcileSyncLog } from './reconciliation';
import { SharedSyncLog } from './shared-sync-log';
import { PromiseContentType } from './types.test';
import { inspect } from 'util';
import { RegistryCollections } from '@worldbrain/storex/lib/registry';

export type TestDependencies = { sharedSyncLog : SharedSyncLog, userId? : number | string, getNow? : () => number | '$now' }
export type TestRunnerOptions = { includeTimestampChecks? : boolean }
type TestDependencyInjector = (body : (dependencies : TestDependencies) => Promise<void>, options? : TestRunnerOptions) => Promise<void>
type TestFunction = (dependencies : TestDependencies) => Promise<void>

function makeTestFactory(withTestDependencies: TestDependencyInjector) {
    return async function wrappedIt(description : string, test : TestFunction, options? : TestRunnerOptions) {
        it(description, async () => {
            await withTestDependencies(async (dependencies : TestDependencies) => {
                await test(dependencies)
            }, options)
        })
    }
}

function integrationTests(withTestDependencies: TestDependencyInjector) {
    function createGetNow(options : { start : number, step?: number }) {
        let now = options.start
        return () => {
            const oldNow = now
            now += options.step || 1
            return oldNow
        }
    }

    async function setupClient(options : {
        backend : { modules: { sharedSyncLog: SharedSyncLog } },
        clientName : string,
        getNow : () => number | '$now',
        pkGenerator : () => string,
        collections? : RegistryCollections
    }) {
        const { storageManager, modules } = await setupStorexTest<{clientSyncLog : ClientSyncLogStorage}>({
            dbName: `client-${options.clientName}`,
            collections: options.collections || {
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
        const includeCollections = options.collections ? Object.keys(options.collections) : ['user', 'email']
        
        const pkMiddleware = new CustomAutoPkMiddleware({ pkGenerator: options.pkGenerator })
        pkMiddleware.setup({ storageRegistry: storageManager.registry, collections: includeCollections })

        const syncLoggingMiddleware = new SyncLoggingMiddleware({ storageManager, clientSyncLog: modules.clientSyncLog, includeCollections })
        syncLoggingMiddleware._getNow = options.getNow

        storageManager.setMiddleware([
            pkMiddleware,
            syncLoggingMiddleware
        ])

        const deviceId : number | string = null as any
        return { storageManager, modules, deviceId, objects: {} }
    }

    async function setupTest(options : {
        dependencies : TestDependencies,
        getNow : () => number | '$now'
        clients? : {name : string}[],
        collections? : RegistryCollections
        getBackend? : (options: { sharedSyncLog: SharedSyncLog }) => { modules: { sharedSyncLog: SharedSyncLog } }
    }) {
        let idsGenerated = 0
        const pkGenerator = () => `id-${++idsGenerated}`

        const userId = options.dependencies.userId || 1
        const getBackend = options.getBackend || (() => ({ modules: { sharedSyncLog: options.dependencies.sharedSyncLog } }))
        const backend = getBackend({ sharedSyncLog: options.dependencies.sharedSyncLog })

        const clients : {[name : string] : PromiseContentType<ReturnType<typeof setupClient>>} = {}
        for (const { name } of options.clients || []) {
            clients[name] = await setupClient({backend, clientName: name, getNow: options.getNow, pkGenerator, collections: options.collections})
            clients[name].deviceId = await backend.modules.sharedSyncLog.createDeviceId({ userId, sharedUntil: null })
        }

        return { backend, clients, userId }
    }

    describe('shareLogEntries()', () => {
        const it = makeTestFactory(withTestDependencies)

        async function setupShareTest(dependencies : TestDependencies) {
            const { backend, clients, userId } = await setupTest({
                dependencies,
                clients: [{ name: 'one' }, { name: 'two' } ],
                getNow: createGetNow({start: 2})
            })
            await clients.one.storageManager.collection('user').createObject({displayName: 'Joe', emails: [{address: 'joe@doe.com'}]})
            
            const share = (options : {now: number}) => shareLogEntries({
                sharedSyncLog: backend.modules.sharedSyncLog, clientSyncLog: clients.one.modules.clientSyncLog,
                userId, deviceId: clients.one.deviceId, now: options.now
            })

            return { backend, clients, userId, share }
        }

        it('should correctly share log entries', async (dependencies : TestDependencies) => {
            const { backend, clients, userId, share } = await setupShareTest(dependencies)

            await share({now: 55})
            expect(await backend.modules.sharedSyncLog.getUnsyncedEntries({ userId, deviceId: clients.two.deviceId })).toEqual({
                entries: [
                    (expect as any).objectContaining({
                        userId,
                        deviceId: clients.one.deviceId,
                        createdOn: 2,
                        sharedOn: 55,
                        data: '{"operation":"create","collection":"user","pk":"id-1","field":null,"value":{"displayName":"Joe"}}',
                    }),
                    (expect as any).objectContaining({
                        userId,
                        deviceId: clients.one.deviceId,
                        createdOn: 3,
                        sharedOn: 55,
                        data: '{"operation":"create","collection":"email","pk":"id-2","field":null,"value":{"address":"joe@doe.com"}}',
                    }),
                ],
                memo: expect.any(Object)
            })
        })

        it('should not reshare entries that are already shared', async (dependencies : TestDependencies) => {
            const { backend, userId, clients, share } = await setupShareTest(dependencies)

            await share({now: 55})
            const update = await backend.modules.sharedSyncLog.getUnsyncedEntries({ userId, deviceId: clients.two.deviceId})
            await share({now: 60})
            expect(await backend.modules.sharedSyncLog.getUnsyncedEntries({ userId, deviceId: clients.two.deviceId })).toEqual({
                ...update,
                memo: expect.any(Object)
            })
        })
    })

    describe('receiveLogEntries()', () => {
        const it = makeTestFactory(withTestDependencies)

        async function setupReceiveTest(dependencies : TestDependencies) {
            const { backend, clients, userId } = await setupTest({
                dependencies,
                clients: [{ name: 'one' },
                { name: 'two' } ],
                getNow: createGetNow({start: 2})
            })
            const receive = async (options : {now : number}) => {
                await receiveLogEntries({
                    clientSyncLog: clients.one.modules.clientSyncLog,
                    sharedSyncLog: backend.modules.sharedSyncLog,
                    userId,
                    deviceId: clients.one.deviceId,
                    now: options.now,
                })
            }
            return { backend, clients, userId, receive }
        }

        it('should correctly receive unsynced entries and write them to the local log marked as needing integration', async (dependencies : TestDependencies) => {
            const { backend, clients, userId, receive } = await setupReceiveTest(dependencies)
            await clients.one.storageManager.collection('user').createObject({displayName: 'Bob'})

            await backend.modules.sharedSyncLog.writeEntries([
                {
                    createdOn: 5,
                    data: '{"operation":"create","collection":"user","pk":"id-2","field":null,"value":{"displayName":"Joe"}}',
                },
                {
                    createdOn: 7,
                    data: '{"operation":"create","collection":"email","pk":"id-3","field":null,"value":{"address":"joe@doe.com"}}',
                },
            ], { now: 55, userId, deviceId: clients.two.deviceId })
            
            await receive({now: 60})
            expect(await clients.one.modules.clientSyncLog.getEntriesCreatedAfter(1)).toEqual([
                {
                    id: (expect as any).anything(),
                    createdOn: 2,
                    sharedOn: null,
                    needsIntegration: false,
                    collection: 'user',
                    pk: 'id-1',
                    operation: 'create',
                    value: { displayName: 'Bob' },
                },
                {
                    id: (expect as any).anything(),
                    createdOn: 5,
                    sharedOn: 60,
                    needsIntegration: true,
                    collection: 'user',
                    pk: 'id-2',
                    operation: 'create',
                    value: { displayName: 'Joe' },
                },
                {
                    id: (expect as any).anything(),
                    createdOn: 7,
                    sharedOn: 60,
                    needsIntegration: true,
                    collection: 'email',
                    pk: 'id-3',
                    operation: 'create',
                    value: { address: 'joe@doe.com' },
                }
            ])
        })
    })

    describe('doSync()', () => {
        const it = makeTestFactory(withTestDependencies)

        async function setupSyncTest(dependencies : TestDependencies, options? : {
            collections : RegistryCollections
            getBackend? : (options : { sharedSyncLog: SharedSyncLog }) => { modules: { sharedSyncLog: SharedSyncLog } }
        }) {
            const getNow = dependencies.getNow || createGetNow({ start: 50, step: 5 })
            const { backend, clients, userId } = await setupTest({
                dependencies,
                clients: [{ name: 'one' }, { name: 'two' }],
                getNow,
                collections: options && options.collections,
                getBackend: options && options.getBackend,
            })
            const sync = async (options : { clientName : string, serializer? : SyncSerializer }) => {
                const client = clients[options.clientName]
                await doSync({
                    clientSyncLog: client.modules.clientSyncLog,
                    sharedSyncLog: backend.modules.sharedSyncLog,
                    storageManager: client.storageManager,
                    reconciler: reconcileSyncLog,
                    now: getNow(),
                    userId,
                    deviceId: client.deviceId,
                    serializer: options.serializer,
                })
            }
            return { clients, backend, sync, userId }
        }

        it('should correctly sync createObject operations', async (dependencies : TestDependencies) => {
            const { clients, sync } = await setupSyncTest(dependencies)
            const orig = (await clients.one.storageManager.collection('user').createObject({
                displayName: 'Joe', emails: [{address: 'joe@doe.com'}]
            })).object
            const { emails, ...user } = orig

            await sync({ clientName: 'one' })
            await sync({ clientName: 'two' })
            
            expect(await clients.two.storageManager.collection('user').findObject({id: user.id})).toEqual(user)
            expect(await clients.two.storageManager.collection('email').findObject({id: emails[0].id})).toEqual(emails[0])
        }, { includeTimestampChecks: true })

        it('should correctly sync updateObject operations', async (dependencies : TestDependencies) => {
            const { clients, sync } = await setupSyncTest(dependencies)
            const orig = (await clients.one.storageManager.collection('user').createObject({
                displayName: 'Joe', emails: [{ address: 'joe@doe.com' }]
            })).object
            await clients.one.storageManager.collection('user').updateOneObject(orig, { displayName: 'Joe Black' })
            const { emails, ...user } = { ...orig, displayName: 'Joe Black' } as any

            await sync({ clientName: 'one' })
            await sync({ clientName: 'two' })
            
            expect(await clients.two.storageManager.collection('user').findObject({id: user.id})).toEqual(user)
            expect(await clients.two.storageManager.collection('email').findObject({id: emails[0].id})).toEqual(emails[0])
        }, { includeTimestampChecks: true })

        it('should correctly sync deleteObject operations', async (dependencies : TestDependencies) => {
            const { clients, sync } = await setupSyncTest(dependencies)
            const orig = (await clients.one.storageManager.collection('user').createObject({
                displayName: 'Joe', emails: [{ address: 'joe@doe.com' }]
            })).object
            await clients.one.storageManager.collection('user').deleteOneObject(orig)
            const { emails, ...user } = { ...orig, displayName: 'Joe Black' } as any

            await sync({ clientName: 'one' })
            await sync({ clientName: 'two' })

            expect(await clients.two.storageManager.collection('user').findObject({id: user.id})).toBeFalsy()
            expect(await clients.two.storageManager.collection('email').findObject({id: emails[0].id})).toEqual(emails[0])

        }, { includeTimestampChecks: true })


        it('should correctly sync deleteObjects operations', async (dependencies : TestDependencies) => {
            const { clients, sync } = await setupSyncTest(dependencies)
            const orig = (await clients.one.storageManager.collection('user').createObject({
                displayName: 'Joe', emails: [{ address: 'joe@doe.com' }]
            })).object

            await clients.one.storageManager.collection('user').deleteObjects({emails: {address: 'joe@dow.com'}})
            const { emails, ...user } = { ...orig, displayName: 'Joe Black' } as any

            await sync({ clientName: 'one' })
            await sync({ clientName: 'two' })

            expect(await clients.two.storageManager.collection('user').findObject({id: user.id})).toBeFalsy()
            expect(await clients.two.storageManager.collection('email').findObject({id: emails[0].id})).toEqual(emails[0])

        }, { includeTimestampChecks: true })

        it('should work with custom serialization/deserialization', async (dependencies : TestDependencies) => {
            const { clients, backend, userId, sync } = await setupSyncTest(dependencies)
            const orig = (await clients.one.storageManager.collection('user').createObject({
                displayName: 'Joe'
            })).object
            const { emails, ...user } = orig

            const serializer : SyncSerializer = {
                serializeSharedSyncLogEntryData: async (data) => `!!!${JSON.stringify(data)}`,
                deserializeSharedSyncLogEntryData: async (serialized) => JSON.parse(serialized.substr(3))
            }

            await sync({ clientName: 'one', serializer })
            expect(await backend.modules.sharedSyncLog.getUnsyncedEntries({ userId, deviceId: clients.two.deviceId })).toEqual({
                entries: [{
                    userId,
                    deviceId: clients.one.deviceId,
                    createdOn: expect.any(Number),
                    sharedOn: expect.any(Number),
                    data: "!!!{\"operation\":\"create\",\"collection\":\"user\",\"pk\":\"id-1\",\"field\":null,\"value\":{\"displayName\":\"Joe\"}}"
                }],
                memo: expect.any(Object),
            })
            await sync({ clientName: 'two', serializer })
            
            expect(await clients.two.storageManager.collection('user').findObject({id: user.id})).toEqual(user)
        }, { includeTimestampChecks: true })

        it('should correctly sync datetimes', async (dependencies : TestDependencies) => {
            const { clients, backend, userId, sync } = await setupSyncTest(dependencies, {
                collections: {
                    entry: {
                        version: new Date(),
                        fields: {
                            createdWhen: { type: 'datetime' },
                        },
                    }
                }
            })

            const createdWhen = new Date()
            const orig = (await clients.one.storageManager.collection('entry').createObject({
                createdWhen
            })).object
            expect(orig.createdWhen).toEqual(createdWhen)

            await sync({ clientName: 'one' })
            await sync({ clientName: 'two' })

            expect(await clients.two.storageManager.collection('entry').findObject({id: orig.id})).toEqual(orig)
        })

        it('should correctly sync createObject operations with a few empty syncs in between', async (dependencies : TestDependencies) => {
            const { clients, sync } = await setupSyncTest(dependencies)
            const orig = (await clients.one.storageManager.collection('user').createObject({
                displayName: 'Joe', emails: [{address: 'joe@doe.com'}]
            })).object
            const { emails, ...user } = orig

            await sync({ clientName: 'one' })
            await sync({ clientName: 'one' })
            await sync({ clientName: 'one' })
            await sync({ clientName: 'two' })
            
            expect(await clients.two.storageManager.collection('user').findObject({id: user.id})).toEqual(user)
            expect(await clients.two.storageManager.collection('email').findObject({id: emails[0].id})).toEqual(emails[0])
        }, { includeTimestampChecks: true })

        it('should correctly sync createObject and updateObject operations', async (dependencies : TestDependencies) => {
            const { clients, sync } = await setupSyncTest(dependencies)
            const orig = (await clients.one.storageManager.collection('user').createObject({
                displayName: 'Joe', emails: [{address: 'joe@doe.com'}]
            })).object
            const { emails, ...user } = orig

            await sync({ clientName: 'one' })

            const userUpdate = { displayName: 'John' }
            await clients.one.storageManager.collection('user').updateObjects({ id: user.id }, userUpdate)

            await sync({ clientName: 'one' })
            await sync({ clientName: 'two' })
            
            expect(await clients.two.storageManager.collection('user').findObject({id: user.id})).toEqual({ ...user, ...userUpdate })
            expect(await clients.two.storageManager.collection('email').findObject({id: emails[0].id})).toEqual(emails[0])
        }, { includeTimestampChecks: true })
        
        // it('should correctly continue sync even if one time we cannot signal seen entries in between', async (dependencies : TestDependencies) => {
        //     const { clients, sync } = await setupSyncTest(dependencies)
        //     const orig = (await clients.one.storageManager.collection('user').createObject({
        //         displayName: 'Joe'
        //     })).object
        //     const { emails, ...user } = orig
        // }, { includeTimestampChecks: true })
    })
}

describe('Storex Sync integration with Storex backend', () => {
    async function setupTestDependencies() : Promise<TestDependencies> {
        return (await setupStorexTest<{sharedSyncLog : SharedSyncLogStorage}>({
            dbName: 'backend',
            collections: {},
            modules: {
                sharedSyncLog: ({storageManager}) => new SharedSyncLogStorage({ storageManager, autoPkType: 'int' })
            }
        })).modules
    }

    integrationTests(async (body : (dependencies : TestDependencies) => Promise<void>) => {
        await body(await setupTestDependencies())
    })
})

if (process.env.TEST_SYNC_GRAPHQL === 'true') {
    describe('Storex Sync integration with Storex backend over GraphQL', () => {
        async function setupTestDependencies() : Promise<TestDependencies> {
            const { modules, storageManager } = await setupStorexTest<{sharedSyncLog : SharedSyncLogStorage}>({
                dbName: 'backend',
                collections: {},
                modules: {
                    sharedSyncLog: ({storageManager}) => new SharedSyncLogStorage({ storageManager, autoPkType: 'int' })
                }
            })

            const { client } = setupTestGraphQLStorexClient({
                serverModules: modules,
                clientModules: modules,
                storageRegistry: storageManager.registry,
                autoPkType: 'int',
                graphql: graphqlModule,
            })
            return client.getModules<{ sharedSyncLog: SharedSyncLog }>()
        }

        integrationTests(async (body : (dependencies : TestDependencies) => Promise<void>) => {
            await body(await setupTestDependencies())
        })
    })
}

if (process.env.TEST_SYNC_FIRESTORE === 'true') {
    describe('Storex Sync integration with Storex Firestore backend', () => {
        integrationTests(async (body : (dependencies : TestDependencies) => Promise<void>, options? : TestRunnerOptions) => {
            await withEmulatedFirestoreBackend({
                sharedSyncLog: ({ storageManager }) => new SharedSyncLogStorage({
                    storageManager, autoPkType: 'string', excludeTimestampChecks: !options || !options.includeTimestampChecks
                }) as any
            }, { auth: { userId: 'alice' }, printProjectId: false, loadRules: false }, async ({ storageManager, modules }) => {
                try {
                    await body({
                        sharedSyncLog: modules.sharedSyncLog as any,
                        userId: 'alice',
                        getNow: () => Date.now(),
                    })
                } catch (e) {
                    const collectionsToDump = ['sharedSyncLogDeviceInfo', 'sharedSyncLogEntryBatch']
                    const dumps = {}
                    try {
                        for (const collectionName of collectionsToDump) {
                            dumps[collectionName] = await storageManager.collection(collectionName).findObjects({ userId: 'alice' })
                        }
                    } catch (ouch) {
                        console.error('Error trying to dump DB for post-portem debugging:')
                        console.error(ouch)
                        throw e
                    }

                    console.error(`DB state after error: ${inspect(dumps, false, null, true)}`)
                    throw e
                }
            })
        })
    })
}