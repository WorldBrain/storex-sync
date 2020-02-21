import expect from 'expect'
import * as graphqlModule from 'graphql'
import { setupStorexTest } from '@worldbrain/storex-pattern-modules/lib/index.tests'
import { setupTestGraphQLStorexClient } from '@worldbrain/storex-graphql-client/lib/index.tests'
import { TypeORMStorageBackend } from '@worldbrain/storex-backend-typeorm'
import { withEmulatedFirestoreBackend } from '@worldbrain/storex-backend-firestore/lib/index.tests'
import { SharedSyncLogStorage } from './shared-sync-log/storex'
import {
    shareLogEntries,
    receiveLogEntries,
    doSync,
    SyncSerializer,
    SyncPreSendProcessor,
    SyncPostReceiveProcessor,
} from '.'
import { reconcileSyncLog } from './reconciliation'
import { SharedSyncLog } from './shared-sync-log'
import { PromiseContentType } from './types.test'
import { inspect } from 'util'
import { RegistryCollections } from '@worldbrain/storex/lib/registry'
import { StorageBackend } from '@worldbrain/storex'
import { ClientSyncLogEntry } from './client-sync-log/types'
import {
    makeTestFactory,
    setupSyncTestClient,
    linearTimestampGenerator,
    TestDependencyInjector,
} from './index.tests'

export type TestDependencies = {
    sharedSyncLog: SharedSyncLog
    createClientStorageBackend?: () => StorageBackend
    userId?: number | string
    getNow?: () => number | '$now'
}
export interface TestRunnerOptions {
    includeTimestampChecks?: boolean
}

function integrationTestSuite(
    withTestDependencies: TestDependencyInjector<
        TestDependencies,
        TestRunnerOptions
    >,
    suiteOptions: { withModificationMerging?: boolean },
) {
    async function setupTest(options: {
        dependencies: TestDependencies
        getNow: () => number | '$now'
        clients?: { name: string }[]
        collections?: RegistryCollections
        getBackend?: (options: {
            sharedSyncLog: SharedSyncLog
        }) => { modules: { sharedSyncLog: SharedSyncLog } }
    }) {
        let idsGenerated = 0
        const pkGenerator = () => `id-${++idsGenerated}`

        const userId = options.dependencies.userId || 1
        const getBackend =
            options.getBackend ||
            (() => ({
                modules: { sharedSyncLog: options.dependencies.sharedSyncLog },
            }))
        const backend = getBackend({
            sharedSyncLog: options.dependencies.sharedSyncLog,
        })

        const clients: {
            [name: string]: PromiseContentType<
                ReturnType<typeof setupSyncTestClient>
            >
        } = {}
        for (const { name } of options.clients || []) {
            clients[name] = await setupSyncTestClient({
                createClientStorageBackend:
                    options.dependencies.createClientStorageBackend,
                getNow: options.getNow,
                pkGenerator,
                collections: options.collections,
                withModificationMerging: suiteOptions.withModificationMerging,
            })
            clients[
                name
            ].deviceId = await backend.modules.sharedSyncLog.createDeviceId({
                userId,
                sharedUntil: null,
            })
            clients[name].syncLoggingMiddleware.enable(clients[name].deviceId)
        }

        return { backend, clients, userId }
    }

    describe('shareLogEntries()', () => {
        const it = makeTestFactory(withTestDependencies)

        async function setupShareTest(dependencies: TestDependencies) {
            const { backend, clients, userId } = await setupTest({
                dependencies,
                clients: [{ name: 'one' }, { name: 'two' }],
                getNow: linearTimestampGenerator({ start: 2 }),
            })
            const {
                object: user,
            } = await clients.one.storageManager
                .collection('user')
                .createObject({
                    displayName: 'Joe',
                })
            await clients.one.storageManager
                .collection('email')
                .createObject({ user: user.id, address: 'joe@doe.com' })

            const share = (options: { now: number; batchSize?: number }) =>
                shareLogEntries({
                    sharedSyncLog: backend.modules.sharedSyncLog,
                    clientSyncLog: clients.one.clientSyncLog,
                    userId,
                    deviceId: clients.one.deviceId,
                    now: options.now,
                    batchSize: options.batchSize,
                })

            return { backend, clients, userId, share }
        }

        it('should correctly share log entries', async (dependencies: TestDependencies) => {
            const { backend, clients, userId, share } = await setupShareTest(
                dependencies,
            )

            await share({ now: 55 })
            expect(
                (
                    await backend.modules.sharedSyncLog.getUnsyncedEntries({
                        userId,
                        deviceId: clients.two.deviceId,
                    })
                ).entries.map(entry => ({
                    ...entry,
                    data: JSON.parse(entry.data),
                })),
            ).toEqual([
                (expect as any).objectContaining({
                    userId,
                    deviceId: clients.one.deviceId,
                    createdOn: 2,
                    sharedOn: 55,
                    data: {
                        operation: 'create',
                        collection: 'user',
                        pk: 'id-1',
                        field: null,
                        value: { displayName: 'Joe' },
                    },
                }),
                (expect as any).objectContaining({
                    userId,
                    deviceId: clients.one.deviceId,
                    createdOn: 3,
                    sharedOn: 55,
                    data: {
                        operation: 'create',
                        collection: 'email',
                        pk: 'id-2',
                        field: null,
                        value: { user: 'id-1', address: 'joe@doe.com' },
                    },
                }),
            ])
        })

        it('should not reshare entries that are already shared', async (dependencies: TestDependencies) => {
            const { backend, userId, clients, share } = await setupShareTest(
                dependencies,
            )

            await share({ now: 55 })
            const update = await backend.modules.sharedSyncLog.getUnsyncedEntries(
                { userId, deviceId: clients.two.deviceId },
            )
            await share({ now: 60 })
            expect(
                await backend.modules.sharedSyncLog.getUnsyncedEntries({
                    userId,
                    deviceId: clients.two.deviceId,
                }),
            ).toEqual({
                ...update,
                memo: expect.any(Object),
            })
        })

        it('should share log entries with limited batch sizes', async (dependencies: TestDependencies) => {
            const { backend, userId, clients, share } = await setupShareTest(
                dependencies,
            )

            const {
                object: user2,
            } = await clients.one.storageManager
                .collection('user')
                .createObject({
                    displayName: 'Jane',
                })
            await clients.one.storageManager.collection('email').createObject({
                user: user2.id,
                address: 'jane@doe.com',
            })
            await share({ now: 55, batchSize: 2 })
            const update = await backend.modules.sharedSyncLog.getUnsyncedEntries(
                { userId, deviceId: clients.two.deviceId },
            )
            expect(
                update.entries.map(entry => ({
                    ...entry,
                    data: JSON.parse(entry.data),
                })),
            ).toEqual([
                {
                    createdOn: 2,
                    data: {
                        operation: 'create',
                        collection: 'user',
                        pk: 'id-1',
                        field: null,
                        value: { displayName: 'Joe' },
                    },
                    sharedOn: 55,
                    deviceId: 1,
                    userId: 1,
                },
                {
                    createdOn: 3,
                    data: {
                        operation: 'create',
                        collection: 'email',
                        pk: 'id-2',
                        field: null,
                        value: { user: 'id-1', address: 'joe@doe.com' },
                    },
                    sharedOn: 55,
                    deviceId: 1,
                    userId: 1,
                },
                {
                    createdOn: 4,
                    data: {
                        operation: 'create',
                        collection: 'user',
                        pk: 'id-3',
                        field: null,
                        value: { displayName: 'Jane' },
                    },
                    sharedOn: 55,
                    deviceId: 1,
                    userId: 1,
                },
                {
                    createdOn: 5,
                    data: {
                        operation: 'create',
                        collection: 'email',
                        pk: 'id-4',
                        field: null,
                        value: { user: 'id-3', address: 'jane@doe.com' },
                    },
                    sharedOn: 55,
                    deviceId: 1,
                    userId: 1,
                },
            ])
        })
    })

    describe('receiveLogEntries()', () => {
        const it = makeTestFactory(withTestDependencies)

        async function setupReceiveTest(dependencies: TestDependencies) {
            const { backend, clients, userId } = await setupTest({
                dependencies,
                clients: [{ name: 'one' }, { name: 'two' }],
                getNow: linearTimestampGenerator({ start: 2 }),
            })
            const receive = async (options: {
                now: number
                batchSize?: number
            }) => {
                await receiveLogEntries({
                    clientSyncLog: clients.one.clientSyncLog,
                    sharedSyncLog: backend.modules.sharedSyncLog,
                    userId,
                    deviceId: clients.one.deviceId,
                    now: options.now,
                    batchSize: options.batchSize,
                })
            }
            return { backend, clients, userId, receive }
        }

        it('should correctly receive unsynced entries and write them to the local log marked as needing integration', async (dependencies: TestDependencies) => {
            const {
                backend,
                clients,
                userId,
                receive,
            } = await setupReceiveTest(dependencies)
            await clients.one.storageManager
                .collection('user')
                .createObject({ displayName: 'Bob' })

            await backend.modules.sharedSyncLog.writeEntries(
                [
                    {
                        createdOn: 5,
                        data:
                            '{"operation":"create","collection":"user","pk":"id-2","field":null,"value":{"displayName":"Joe"}}',
                    },
                    {
                        createdOn: 7,
                        data:
                            '{"operation":"create","collection":"email","pk":"id-3","field":null,"value":{"address":"joe@doe.com"}}',
                    },
                ],
                { now: 55, userId, deviceId: clients.two.deviceId },
            )

            await receive({ now: 60 })
            expect(
                await clients.one.clientSyncLog.getEntriesCreatedAfter(1),
            ).toEqual([
                (expect as any).objectContaining({
                    deviceId: 1,
                    createdOn: 2,
                    needsIntegration: false,
                    collection: 'user',
                    pk: 'id-1',
                    operation: 'create',
                    field: null,
                    value: { displayName: 'Bob' },
                }),
                {
                    deviceId: 2,
                    createdOn: 5,
                    sharedOn: 60,
                    needsIntegration: true,
                    collection: 'user',
                    pk: 'id-2',
                    operation: 'create',
                    field: null,
                    value: { displayName: 'Joe' },
                },
                {
                    deviceId: 2,
                    createdOn: 7,
                    sharedOn: 60,
                    needsIntegration: true,
                    collection: 'email',
                    pk: 'id-3',
                    operation: 'create',
                    field: null,
                    value: { address: 'joe@doe.com' },
                },
            ])
        })
        it('should receive log entries with limited batch sizes', async (dependencies: TestDependencies) => {
            const {
                backend,
                clients,
                userId,
                receive,
            } = await setupReceiveTest(dependencies)

            await backend.modules.sharedSyncLog.writeEntries(
                [
                    {
                        createdOn: 3,
                        data:
                            '{"operation":"create","collection":"user","pk":"id-1","field":null,"value":{"displayName":"Joe"}}',
                    },
                    {
                        createdOn: 5,
                        data:
                            '{"operation":"create","collection":"email","pk":"id-2","field":null,"value":{"address":"joe@doe.com"}}',
                    },
                    {
                        createdOn: 7,
                        data:
                            '{"operation":"create","collection":"user","pk":"id-3","field":null,"value":{"displayName":"Jane"}}',
                    },
                    {
                        createdOn: 9,
                        data:
                            '{"operation":"create","collection":"email","pk":"id-4","field":null,"value":{"address":"jane@doe.com"}}',
                    },
                ],
                { now: 55, userId, deviceId: clients.two.deviceId },
            )

            await receive({ now: 60, batchSize: 2 })
            expect(
                await clients.one.clientSyncLog.getEntriesCreatedAfter(1),
            ).toEqual([
                {
                    deviceId: 2,
                    createdOn: 3,
                    sharedOn: 60,
                    needsIntegration: true,
                    collection: 'user',
                    pk: 'id-1',
                    operation: 'create',
                    field: null,
                    value: { displayName: 'Joe' },
                },
                {
                    deviceId: 2,
                    createdOn: 5,
                    sharedOn: 60,
                    needsIntegration: true,
                    collection: 'email',
                    pk: 'id-2',
                    operation: 'create',
                    field: null,
                    value: { address: 'joe@doe.com' },
                },
                {
                    deviceId: 2,
                    createdOn: 7,
                    sharedOn: 60,
                    needsIntegration: true,
                    collection: 'user',
                    pk: 'id-3',
                    operation: 'create',
                    field: null,
                    value: { displayName: 'Jane' },
                },
                {
                    deviceId: 2,
                    createdOn: 9,
                    sharedOn: 60,
                    needsIntegration: true,
                    collection: 'email',
                    pk: 'id-4',
                    operation: 'create',
                    field: null,
                    value: { address: 'jane@doe.com' },
                },
            ])
        })
    })

    describe('doSync()', () => {
        const it = makeTestFactory(withTestDependencies)

        async function setupSyncTest(
            dependencies: TestDependencies,
            options?: {
                collections: RegistryCollections
                getBackend?: (options: {
                    sharedSyncLog: SharedSyncLog
                }) => { modules: { sharedSyncLog: SharedSyncLog } }
            },
        ) {
            const getNow =
                dependencies.getNow ||
                linearTimestampGenerator({ start: 50, step: 5 })
            const { backend, clients, userId } = await setupTest({
                dependencies,
                clients: [{ name: 'one' }, { name: 'two' }],
                getNow,
                collections: options && options.collections,
                getBackend: options && options.getBackend,
            })
            const sync = async (options: {
                clientName: string
                serializer?: SyncSerializer
                preSend?: SyncPreSendProcessor
                postReceive?: SyncPostReceiveProcessor
                extraSentInfo?: any
                batchSize?: number
            }) => {
                const client = clients[options.clientName]
                await doSync({
                    clientSyncLog: client.clientSyncLog,
                    sharedSyncLog: backend.modules.sharedSyncLog,
                    storageManager: client.storageManager,
                    reconciler: reconcileSyncLog,
                    now: getNow(),
                    userId,
                    deviceId: client.deviceId,
                    serializer: options.serializer,
                    preSend: options.preSend,
                    postReceive: options.postReceive,
                    extraSentInfo: options.extraSentInfo,
                    batchSize: options.batchSize,
                })
            }
            return { clients, backend, sync, userId }
        }

        it(
            'should correctly sync createObject operations',
            async (dependencies: TestDependencies) => {
                const { clients, sync } = await setupSyncTest(dependencies)
                const user = (
                    await clients.one.storageManager
                        .collection('user')
                        .createObject({
                            displayName: 'Joe',
                        })
                ).object

                await sync({ clientName: 'one' })
                await sync({ clientName: 'two' })

                expect(
                    await clients.two.storageManager
                        .collection('user')
                        .findObject({ id: user.id }),
                ).toEqual(user)
            },
            { includeTimestampChecks: true },
        )

        it(
            'should correctly sync updateObject operations',
            async (dependencies: TestDependencies) => {
                const { clients, sync } = await setupSyncTest(dependencies)
                const user = (
                    await clients.one.storageManager
                        .collection('user')
                        .createObject({
                            displayName: 'Joe',
                        })
                ).object
                await clients.one.storageManager
                    .collection('user')
                    .updateOneObject(user, { displayName: 'Joe Black' })

                await sync({ clientName: 'one' })
                await sync({ clientName: 'two' })

                expect(
                    await clients.two.storageManager
                        .collection('user')
                        .findObject({ id: user.id }),
                ).toEqual({ ...user, displayName: 'Joe Black' })
            },
            { includeTimestampChecks: true },
        )

        it(
            'should correctly sync deleteObject operations',
            async (dependencies: TestDependencies) => {
                const { clients, sync } = await setupSyncTest(dependencies)
                const orig = (
                    await clients.one.storageManager
                        .collection('user')
                        .createObject({
                            displayName: 'Joe',
                        })
                ).object
                await clients.one.storageManager
                    .collection('user')
                    .deleteOneObject(orig)
                const { ...user } = {
                    ...orig,
                    displayName: 'Joe Black',
                } as any

                await sync({ clientName: 'one' })
                await sync({ clientName: 'two' })

                expect(
                    await clients.two.storageManager
                        .collection('user')
                        .findObject({ id: user.id }),
                ).toBeFalsy()
            },
            { includeTimestampChecks: true },
        )

        it(
            'should correctly sync deleteObjects operations',
            async (dependencies: TestDependencies) => {
                const { clients, sync } = await setupSyncTest(dependencies)
                const user1 = (
                    await clients.one.storageManager
                        .collection('user')
                        .createObject({
                            displayName: 'Joe',
                        })
                ).object
                const user2 = (
                    await clients.one.storageManager
                        .collection('user')
                        .createObject({
                            displayName: 'Jane',
                        })
                ).object

                await clients.one.storageManager
                    .collection('user')
                    .deleteObjects({ displayName: 'Joe' })

                await sync({ clientName: 'one' })
                await sync({ clientName: 'two' })

                expect(
                    await clients.two.storageManager
                        .collection('user')
                        .findObjects({}),
                ).toEqual([user2])
            },
            { includeTimestampChecks: true },
        )

        it(
            'should work with custom serialization/deserialization',
            async (dependencies: TestDependencies) => {
                const { clients, backend, userId, sync } = await setupSyncTest(
                    dependencies,
                )
                const orig = (
                    await clients.one.storageManager
                        .collection('user')
                        .createObject({
                            displayName: 'Joe',
                        })
                ).object
                const { emails, ...user } = orig

                const serializer: SyncSerializer = {
                    serializeSharedSyncLogEntryData: async data =>
                        `!!!${JSON.stringify(data)}`,
                    deserializeSharedSyncLogEntryData: async serialized =>
                        JSON.parse(serialized.substr(3)),
                }

                await sync({ clientName: 'one', serializer })
                expect(
                    await backend.modules.sharedSyncLog.getUnsyncedEntries({
                        userId,
                        deviceId: clients.two.deviceId,
                    }),
                ).toEqual({
                    entries: [
                        {
                            userId,
                            deviceId: clients.one.deviceId,
                            createdOn: expect.any(Number),
                            sharedOn: expect.any(Number),
                            data:
                                '!!!{"operation":"create","collection":"user","pk":"id-1","field":null,"value":{"displayName":"Joe"}}',
                        },
                    ],
                    memo: expect.any(Object),
                })
                await sync({ clientName: 'two', serializer })

                expect(
                    await clients.two.storageManager
                        .collection('user')
                        .findObject({ id: user.id }),
                ).toEqual(user)
            },
            { includeTimestampChecks: true },
        )

        it('should correctly sync datetimes', async (dependencies: TestDependencies) => {
            const { clients, backend, userId, sync } = await setupSyncTest(
                dependencies,
                {
                    collections: {
                        entry: {
                            version: new Date(),
                            fields: {
                                createdWhen: { type: 'datetime' },
                            },
                        },
                    },
                },
            )

            const createdWhen = new Date()
            const orig = (
                await clients.one.storageManager
                    .collection('entry')
                    .createObject({
                        createdWhen,
                    })
            ).object
            expect(orig.createdWhen).toEqual(createdWhen)

            await sync({ clientName: 'one' })
            await sync({ clientName: 'two' })

            expect(
                await clients.two.storageManager
                    .collection('entry')
                    .findObject({ id: orig.id }),
            ).toEqual(orig)
        })

        it(
            'should correctly sync createObject operations with a few empty syncs in between',
            async (dependencies: TestDependencies) => {
                const { clients, sync } = await setupSyncTest(dependencies)
                const orig = (
                    await clients.one.storageManager
                        .collection('user')
                        .createObject({
                            displayName: 'Joe',
                        })
                ).object
                const { ...user } = orig

                await sync({ clientName: 'one' })
                await sync({ clientName: 'one' })
                await sync({ clientName: 'one' })
                await sync({ clientName: 'two' })

                expect(
                    await clients.two.storageManager
                        .collection('user')
                        .findObject({ id: user.id }),
                ).toEqual(user)
            },
            { includeTimestampChecks: true },
        )

        it(
            'should allow for filtering sent operations',
            async (dependencies: TestDependencies) => {
                const { clients, sync } = await setupSyncTest(dependencies)
                const users = []
                for (const displayName of ['Jane', 'Joe', 'Jack']) {
                    users.push(
                        (
                            await clients.one.storageManager
                                .collection('user')
                                .createObject({
                                    displayName,
                                })
                        ).object,
                    )
                }

                await sync({
                    clientName: 'one',
                    preSend: async (params: { entry: ClientSyncLogEntry }) => {
                        if (params.entry.operation !== 'create') {
                            return params
                        }

                        return {
                            entry:
                                params.entry.value.displayName !== 'Joe'
                                    ? params.entry
                                    : null,
                        }
                    },
                })
                await sync({ clientName: 'two' })

                expect(
                    await clients.two.storageManager
                        .collection('user')
                        .findObjects({}),
                ).toEqual([users[0], users[2]])
            },
            { includeTimestampChecks: true },
        )

        it(
            'should allow for modifying sent operations',
            async (dependencies: TestDependencies) => {
                const { clients, sync } = await setupSyncTest(dependencies)
                const users = []
                for (const displayName of ['Jane', 'Joe', 'Jack']) {
                    users.push(
                        (
                            await clients.one.storageManager
                                .collection('user')
                                .createObject({
                                    displayName,
                                })
                        ).object,
                    )
                }

                await sync({
                    clientName: 'one',
                    preSend: async (params: { entry: ClientSyncLogEntry }) => {
                        if (params.entry.operation !== 'create') {
                            return params
                        }

                        return {
                            entry: {
                                ...params.entry,
                                value: {
                                    ...params.entry.value,
                                    displayName:
                                        params.entry.value.displayName + '!!',
                                },
                            },
                        }
                    },
                })
                await sync({ clientName: 'two' })

                expect(
                    await clients.two.storageManager
                        .collection('user')
                        .findObjects({}),
                ).toEqual([
                    { ...users[0], displayName: 'Jane!!' },
                    { ...users[1], displayName: 'Joe!!' },
                    { ...users[2], displayName: 'Jack!!' },
                ])
            },
            { includeTimestampChecks: true },
        )

        it(
            'should allow for filtering received operations',
            async (dependencies: TestDependencies) => {
                const { clients, sync } = await setupSyncTest(dependencies)
                const users = []
                for (const displayName of ['Jane', 'Joe', 'Jack']) {
                    users.push(
                        (
                            await clients.one.storageManager
                                .collection('user')
                                .createObject({
                                    displayName,
                                })
                        ).object,
                    )
                }

                await sync({ clientName: 'one' })
                await sync({
                    clientName: 'two',
                    postReceive: async params => {
                        if (params.entry.data.operation !== 'create') {
                            return params
                        }

                        return {
                            entry:
                                params.entry.data.value.displayName !== 'Joe'
                                    ? params.entry
                                    : null,
                        }
                    },
                })

                expect(
                    await clients.two.storageManager
                        .collection('user')
                        .findObjects({}),
                ).toEqual([users[0], users[2]])
            },
            { includeTimestampChecks: true },
        )

        it(
            'should allow for modifying received operations',
            async (dependencies: TestDependencies) => {
                const { clients, sync } = await setupSyncTest(dependencies)
                const users = []
                for (const displayName of ['Jane', 'Joe', 'Jack']) {
                    users.push(
                        (
                            await clients.one.storageManager
                                .collection('user')
                                .createObject({
                                    displayName,
                                })
                        ).object,
                    )
                }

                await sync({ clientName: 'one' })
                await sync({
                    clientName: 'two',
                    postReceive: async params => {
                        if (params.entry.data.operation !== 'create') {
                            return params
                        }

                        return {
                            entry: {
                                ...params.entry,
                                data: {
                                    ...params.entry.data,
                                    value: {
                                        ...params.entry.data.value,
                                        displayName:
                                            params.entry.data.value
                                                .displayName + '!!',
                                    },
                                },
                            },
                        }
                    },
                })

                expect(
                    await clients.two.storageManager
                        .collection('user')
                        .findObjects({}),
                ).toEqual([
                    { ...users[0], displayName: 'Jane!!' },
                    { ...users[1], displayName: 'Joe!!' },
                    { ...users[2], displayName: 'Jack!!' },
                ])
            },
            { includeTimestampChecks: true },
        )

        it(
            'should allow for sending and receiving custom information when syncing',
            async (dependencies: TestDependencies) => {
                const { clients, sync } = await setupSyncTest(dependencies)
                const users = []
                for (const displayName of ['Jane', 'Joe', 'Jack']) {
                    users.push(
                        (
                            await clients.one.storageManager
                                .collection('user')
                                .createObject({
                                    displayName,
                                })
                        ).object,
                    )
                }

                let receivedExtraInfo: any[] = []
                const extraSentInfo = { appVersion: 666 }
                await sync({ clientName: 'one', extraSentInfo })
                await sync({
                    clientName: 'two',
                    postReceive: async params => {
                        receivedExtraInfo.push(params.entry.extraInfo)
                        return params
                    },
                })

                expect(receivedExtraInfo).toEqual([
                    extraSentInfo,
                    extraSentInfo,
                    extraSentInfo,
                ])
                expect(
                    await clients.two.storageManager
                        .collection('user')
                        .findObjects({}),
                ).toEqual(users)
            },
            { includeTimestampChecks: true },
        )

        it(
            'should correctly sync createObject and updateObject operations',
            async (dependencies: TestDependencies) => {
                const { clients, sync } = await setupSyncTest(dependencies)
                const orig = (
                    await clients.one.storageManager
                        .collection('user')
                        .createObject({
                            displayName: 'Joe',
                        })
                ).object
                const { ...user } = orig

                await sync({ clientName: 'one' })

                const userUpdate = { displayName: 'John' }
                await clients.one.storageManager
                    .collection('user')
                    .updateObjects({ id: user.id }, userUpdate)

                await sync({ clientName: 'one' })
                await sync({ clientName: 'two' })

                expect(
                    await clients.two.storageManager
                        .collection('user')
                        .findObject({ id: user.id }),
                ).toEqual({ ...user, ...userUpdate })
            },
            { includeTimestampChecks: true },
        )

        it(
            'should correctly sync createObject and updateObject operations with limited batch sizes',
            async (dependencies: TestDependencies) => {
                const { clients, sync } = await setupSyncTest(dependencies)
                const orig = (
                    await clients.one.storageManager
                        .collection('user')
                        .createObject({
                            displayName: 'Joe',
                        })
                ).object
                const { ...user } = orig

                await clients.one.storageManager
                    .collection('user')
                    .updateObjects({ id: user.id }, { displayName: 'Bob' })
                await clients.one.storageManager
                    .collection('user')
                    .updateObjects({ id: user.id }, { displayName: 'Jane' })

                const lastUserUpdate = { displayName: 'John' }
                await clients.one.storageManager
                    .collection('user')
                    .updateObjects({ id: user.id }, lastUserUpdate)

                await sync({ clientName: 'one', batchSize: 2 })
                await sync({ clientName: 'two', batchSize: 2 })

                expect(
                    await clients.two.storageManager
                        .collection('user')
                        .findObject({ id: user.id }),
                ).toEqual({ ...user, ...lastUserUpdate })
            },
            { includeTimestampChecks: true },
        )

        // it('should correctly continue sync even if one time we cannot signal seen entries in between', async (dependencies : TestDependencies) => {
        //     const { clients, sync } = await setupSyncTest(dependencies)
        //     const orig = (await clients.one.storageManager.collection('user').createObject({
        //         displayName: 'Joe'
        //     })).object
        //     const { emails, ...user } = orig
        // }, { includeTimestampChecks: true })
    })
}

function integrationTests(
    withTestDependencies: TestDependencyInjector<
        TestDependencies,
        TestRunnerOptions
    >,
) {
    describe('With modification merging', () => {
        integrationTestSuite(withTestDependencies, {
            withModificationMerging: true,
        })
    })
    describe('Without modification merging', () => {
        integrationTestSuite(withTestDependencies, {
            withModificationMerging: false,
        })
    })
}

describe('Storex Sync integration with in-memory Dexie Storex backend', () => {
    async function setupTestDependencies(): Promise<TestDependencies> {
        return (
            await setupStorexTest<{ sharedSyncLog: SharedSyncLogStorage }>({
                dbName: 'backend',
                collections: {},
                modules: {
                    sharedSyncLog: ({ storageManager }) =>
                        new SharedSyncLogStorage({
                            storageManager,
                            autoPkType: 'int',
                        }),
                },
            })
        ).modules
    }

    integrationTests(
        async (body: (dependencies: TestDependencies) => Promise<void>) => {
            await body(await setupTestDependencies())
        },
    )
})

describe('Storex Sync integration with in-memory TypeORM Storex backend', () => {
    async function setupTestDependencies(
        createClientStorageBackend: () => StorageBackend,
    ): Promise<TestDependencies> {
        const serverModules = (
            await setupStorexTest<{
                sharedSyncLog: SharedSyncLogStorage
            }>({
                collections: {},
                modules: {
                    sharedSyncLog: ({ storageManager }) =>
                        new SharedSyncLogStorage({
                            storageManager,
                            autoPkType: 'int',
                        }),
                },
            })
        ).modules

        return {
            sharedSyncLog: serverModules.sharedSyncLog,
            createClientStorageBackend,
        }
    }

    integrationTests(
        async (body: (dependencies: TestDependencies) => Promise<void>) => {
            let clientStorageBackends: TypeORMStorageBackend[] = []
            const createClientStorageBackend = (): StorageBackend => {
                const backend = new TypeORMStorageBackend({
                    connectionOptions: {
                        type: 'sqlite',
                        database: ':memory:',
                        name: `connection-${clientStorageBackends.length}`,
                    },
                    // connectionOptions: { type: 'sqlite', database: ':memory:', logging: true },
                    // connectionOptions: { type: 'sqlite', database: '/tmp/test.sqlite', logging: true },
                })
                clientStorageBackends.push(backend)
                return backend as any
            }
            try {
                const dependencies = await setupTestDependencies(
                    createClientStorageBackend,
                )
                await body(dependencies)
            } finally {
                await Promise.all(
                    clientStorageBackends.map(async backend => {
                        if (backend.connection) {
                            await backend.connection.close()
                        }
                    }),
                )
            }
        },
    )
})

if (process.env.TEST_SYNC_GRAPHQL === 'true') {
    describe('Storex Sync integration with Storex backend over GraphQL', () => {
        async function setupTestDependencies(): Promise<TestDependencies> {
            const { modules, storageManager } = await setupStorexTest<{
                sharedSyncLog: SharedSyncLogStorage
            }>({
                dbName: 'backend',
                collections: {},
                modules: {
                    sharedSyncLog: ({ storageManager }) =>
                        new SharedSyncLogStorage({
                            storageManager,
                            autoPkType: 'int',
                        }),
                },
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

        integrationTests(
            async (body: (dependencies: TestDependencies) => Promise<void>) => {
                await body(await setupTestDependencies())
            },
        )
    })
}

if (process.env.TEST_SYNC_FIRESTORE === 'true') {
    describe('Storex Sync integration with Storex Firestore backend', () => {
        integrationTests(
            async (
                body: (dependencies: TestDependencies) => Promise<void>,
                options?: TestRunnerOptions,
            ) => {
                await withEmulatedFirestoreBackend(
                    {
                        sharedSyncLog: ({ storageManager }) =>
                            new SharedSyncLogStorage({
                                storageManager,
                                autoPkType: 'string',
                                excludeTimestampChecks:
                                    !options || !options.includeTimestampChecks,
                            }) as any,
                    },
                    {
                        auth: { userId: 'alice' },
                        printProjectId: false,
                        loadRules: false,
                    },
                    async ({ storageManager, modules }) => {
                        try {
                            await body({
                                sharedSyncLog: modules.sharedSyncLog as any,
                                userId: 'alice',
                                getNow: () => Date.now(),
                            })
                        } catch (e) {
                            const collectionsToDump = [
                                'sharedSyncLogDeviceInfo',
                                'sharedSyncLogEntryBatch',
                            ]
                            const dumps = {}
                            try {
                                for (const collectionName of collectionsToDump) {
                                    dumps[
                                        collectionName
                                    ] = await storageManager
                                        .collection(collectionName)
                                        .findObjects({ userId: 'alice' })
                                }
                            } catch (ouch) {
                                console.error(
                                    'Error trying to dump DB for post-portem debugging:',
                                )
                                console.error(ouch)
                                throw e
                            }

                            console.error(
                                `DB state after error: ${inspect(
                                    dumps,
                                    false,
                                    null,
                                    true,
                                )}`,
                            )
                            throw e
                        }
                    },
                )
            },
        )
    })
}
