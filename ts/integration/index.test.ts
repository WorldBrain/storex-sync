const wrtc = require('wrtc')
import expect from 'expect'
import { RegistryCollections } from '@worldbrain/storex/lib/registry'
import { setupSyncTestClient, linearTimestampGenerator } from '../index.tests'
import { TEST_DATA } from '../index.test.data'
import { InitialSync } from './initial-sync'
import { ContinuousSync, ContinuousSyncDependencies } from './continuous-sync'
import {
    createMemorySharedSyncLog,
    lazyMemorySignalTransportFactory,
} from './index.tests'
import { registerModuleMapCollections } from '@worldbrain/storex-pattern-modules'
import { FastSyncEvents } from '../fast-sync'
import { PromiseContentType } from '../types.test'
import { FastSyncChannel } from '../fast-sync/types'

describe('Integration helpers', () => {
    async function setupTest(options: {
        collections: RegistryCollections
        continuousSyncDependenciesProcessor?: (
            deps: ContinuousSyncDependencies,
            options: { clientIndex: number },
        ) => ContinuousSyncDependencies
    }) {
        const getNow = linearTimestampGenerator({ start: 1 })
        const clients = [
            await setupSyncTestClient({
                getNow,
                collections: options.collections,
                dontFinishInitialization: true,
            }),
            await setupSyncTestClient({
                getNow,
                collections: options.collections,
                dontFinishInitialization: true,
            }),
        ]
        const signalTransportFactory = lazyMemorySignalTransportFactory()
        const sharedSyncLog = await createMemorySharedSyncLog()
        const integration = clients.map((client, index) => {
            const settings = {}

            const initialSync = new InitialSync({
                storageManager: client.storageManager,
                signalTransportFactory,
                syncedCollections: Object.keys(options.collections),
                batchSize: 1,
            })
            initialSync.wrtc = wrtc

            const continuousSyncDeps: ContinuousSyncDependencies = {
                auth: { getUserId: async () => 456 },
                storageManager: client.storageManager,
                clientSyncLog: client.clientSyncLog,
                getSharedSyncLog: async () => sharedSyncLog,
                settingStore: {
                    storeSetting: async (key, value) => {
                        settings[key] = value
                    },
                    retrieveSetting: async key => settings[key],
                },
                toggleSyncLogging: client.syncLoggingMiddleware.toggle.bind(
                    client.syncLoggingMiddleware,
                ),
            }
            const continuousSync = new ContinuousSync(
                options.continuousSyncDependenciesProcessor
                    ? options.continuousSyncDependenciesProcessor(
                          continuousSyncDeps,
                          { clientIndex: index },
                      )
                    : continuousSyncDeps,
            )

            return {
                settings,
                initialSync,
                continuousSync,
            }
        })

        for (const clientIndex of [0, 1]) {
            await clients[clientIndex].storageManager.finishInitialization()
        }

        const doInitialSync = async (options: {
            source: {
                initialSync: InitialSync
                fastSyncChannelSetup?: (channel: FastSyncChannel) => void
            }
            target: {
                initialSync: InitialSync
                fastSyncChannelSetup?: (channel: FastSyncChannel) => void
            }
        }) => {
            const {
                initialMessage,
            } = await options.source.initialSync.requestInitialSync({
                fastSyncChannelSetup: options.source.fastSyncChannelSetup,
            })

            await options.target.initialSync.answerInitialSync({
                initialMessage,
                fastSyncChannelSetup: options.target.fastSyncChannelSetup,
            })

            for (const client of [options.source, options.target]) {
                await client.initialSync.waitForInitialSync()
            }
        }

        return { clients, integration, doInitialSync }
    }

    async function testTwoWaySync(options: {
        insertData: (
            clients: Array<
                PromiseContentType<ReturnType<typeof setupSyncTestClient>>
            >,
        ) => Promise<void>
        validateSenderRoleSwitch: FastSyncEvents['roleSwitch']
        expectNoData?: boolean
    }) {
        const { clients, integration, doInitialSync } = await setupTest({
            collections: {
                test: {
                    version: new Date(),
                    fields: {
                        key: { type: 'string' },
                        label: { type: 'string' },
                        createWhen: { type: 'datetime' },
                    },
                    indices: [{ field: 'key', pk: true }],
                },
            },
        })

        await options.insertData(clients)

        integration[0].initialSync.events.once('roleSwitch', event => {
            options.validateSenderRoleSwitch(event)
        })

        await doInitialSync({
            source: integration[0],
            target: integration[1],
        })

        expect({
            device: 'two',
            objects: await clients[1].storageManager
                .collection('test')
                .findObjects({}, { order: [['createdWhen', 'asc']] }),
        }).toEqual({
            device: 'two',
            objects: options.expectNoData
                ? []
                : [
                      expect.objectContaining(TEST_DATA.test1),
                      expect.objectContaining(TEST_DATA.test2),
                      expect.objectContaining(TEST_DATA.test3),
                  ],
        })

        expect({
            device: 'one',
            objects: await clients[0].storageManager
                .collection('test')
                .findObjects({}, { order: [['createdWhen', 'asc']] }),
        }).toEqual({
            device: 'one',
            objects: options.expectNoData
                ? []
                : [
                      (expect as any).objectContaining(TEST_DATA.test1),
                      (expect as any).objectContaining(TEST_DATA.test2),
                      (expect as any).objectContaining(TEST_DATA.test3),
                  ],
        })
    }

    it('should do a successful two way initial sync through integration classes with the receiver having less data', async () => {
        await testTwoWaySync({
            async insertData(clients) {
                await clients[0].storageManager
                    .collection('test')
                    .createObject(TEST_DATA.test1)
                await clients[0].storageManager
                    .collection('test')
                    .createObject(TEST_DATA.test2)
                await clients[1].storageManager
                    .collection('test')
                    .createObject(TEST_DATA.test3)
            },
            validateSenderRoleSwitch(event) {
                expect(event).toEqual({
                    before: 'receiver',
                    after: 'sender',
                })
            },
        })
    })

    it('should do a successful two way initial sync through integration classes with the sender having less data', async () => {
        await testTwoWaySync({
            async insertData(clients) {
                await clients[0].storageManager
                    .collection('test')
                    .createObject(TEST_DATA.test1)
                await clients[1].storageManager
                    .collection('test')
                    .createObject(TEST_DATA.test2)
                await clients[1].storageManager
                    .collection('test')
                    .createObject(TEST_DATA.test3)
            },
            validateSenderRoleSwitch(event) {
                expect(event).toEqual({
                    before: 'sender',
                    after: 'receiver',
                })
            },
        })
    })

    it('should do a successful two way initial sync through integration classes without any data', async () => {
        await testTwoWaySync({
            async insertData(clients) {},
            validateSenderRoleSwitch(event) {
                expect(event).toEqual({
                    before: 'receiver',
                    after: 'sender',
                })
            },
            expectNoData: true,
        })
    })

    it('should re-establish connection if stall detected during initial sync', async () => {
        const { clients, integration, doInitialSync } = await setupTest({
            collections: {
                test: {
                    version: new Date(),
                    fields: {
                        key: { type: 'string' },
                        label: { type: 'string' },
                        createWhen: { type: 'datetime' },
                    },
                    indices: [{ field: 'key', pk: true }],
                },
            },
        })

        await clients[0].storageManager
            .collection('test')
            .createObject(TEST_DATA.test1)
        await clients[0].storageManager
            .collection('test')
            .createObject(TEST_DATA.test2)
        await clients[0].storageManager
            .collection('test')
            .createObject(TEST_DATA.test3)

        let reconnected = false

        integration[0].initialSync.events.on('reconnected', () => {
            reconnected = true
        })

        expect(reconnected).toBe(false)

        await doInitialSync({
            source: {
                ...integration[0],
                fastSyncChannelSetup: channel => {
                    channel.timeoutInMiliseconds = 100
                },
            },
            target: {
                ...integration[1],
                fastSyncChannelSetup: channel => {
                    channel.preSend = () =>
                        new Promise(resolve => setTimeout(resolve, 500))
                },
            },
        })

        expect(reconnected).toBe(true)

        expect(
            await clients[1].storageManager
                .collection('test')
                .findObjects({}, { order: [['createdWhen', 'asc']] }),
        ).toEqual([
            (expect as any).objectContaining(TEST_DATA.test1),
            (expect as any).objectContaining(TEST_DATA.test2),
            (expect as any).objectContaining(TEST_DATA.test3),
        ])
    })

    it('should not crash if trying to abort the sync without notifying the other side', async () => {
        const { clients, integration } = await setupTest({
            collections: {
                test: {
                    version: new Date(),
                    fields: {
                        key: { type: 'string' },
                        label: { type: 'string' },
                        createWhen: { type: 'datetime' },
                    },
                    indices: [{ field: 'key', pk: true }],
                },
            },
        })

        await clients[0].storageManager
            .collection('test')
            .createObject(TEST_DATA.test1)
        await clients[0].storageManager
            .collection('test')
            .createObject(TEST_DATA.test2)
        await clients[0].storageManager
            .collection('test')
            .createObject(TEST_DATA.test3)

        integration[0].initialSync.events.on('progress', ({ progress }) => {
            if (progress.totalObjectsProcessed === 1) {
                integration[0].initialSync.abortInitialSync()
            }
        })

        const {
            initialMessage,
        } = await integration[0].initialSync.requestInitialSync()
        await integration[1].initialSync.answerInitialSync({
            initialMessage,
        })
        await integration[0].initialSync.waitForInitialSync()

        expect(
            await clients[1].storageManager
                .collection('test')
                .findObjects({}, { order: [['createdWhen', 'asc']] }),
        ).toEqual([(expect as any).objectContaining(TEST_DATA.test1)])
    })

    it('should do a continuous sync with a small batch size and a upload batch byte limit being exceeded', async () => {
        const { clients, integration } = await setupTest({
            collections: {
                test: {
                    version: new Date(),
                    fields: {
                        key: { type: 'string' },
                        label: { type: 'string' },
                        createWhen: { type: 'datetime' },
                    },
                    indices: [{ field: 'key', pk: true }],
                },
            },
            continuousSyncDependenciesProcessor: (
                dependencies,
            ): ContinuousSyncDependencies => ({
                ...dependencies,
                uploadBatchSize: 2,
                uploadBatchByteLimit: 300,
            }),
        })

        await integration[0].continuousSync.initDevice()
        await integration[0].continuousSync.enableContinuousSync()

        await integration[1].continuousSync.initDevice()
        await integration[1].continuousSync.enableContinuousSync()

        await clients[0].storageManager
            .collection('test')
            .createObject(TEST_DATA.test1)
        await clients[0].storageManager
            .collection('test')
            .createObject(TEST_DATA.test2)
        await clients[0].storageManager
            .collection('test')
            .createObject(TEST_DATA.test3)

        await integration[0].continuousSync.forceIncrementalSync()
        await integration[1].continuousSync.forceIncrementalSync()

        expect(
            await clients[1].storageManager
                .collection('test')
                .findObjects({}, { order: [['createdWhen', 'asc']] }),
        ).toEqual([
            (expect as any).objectContaining(TEST_DATA.test1),
            (expect as any).objectContaining(TEST_DATA.test2),
            (expect as any).objectContaining(TEST_DATA.test3),
        ])
    })

    it('should throw an error when it cannot satisfy a batch byte limit', async () => {
        const { clients, integration } = await setupTest({
            collections: {
                test: {
                    version: new Date(),
                    fields: {
                        key: { type: 'string' },
                        label: { type: 'string' },
                        createWhen: { type: 'datetime' },
                    },
                    indices: [{ field: 'key', pk: true }],
                },
            },
            continuousSyncDependenciesProcessor: (
                dependencies,
            ): ContinuousSyncDependencies => ({
                ...dependencies,
                uploadBatchSize: 2,
                uploadBatchByteLimit: 100,
            }),
        })

        const events: any[] = []
        integration[0].continuousSync.events.on('syncFinished', event =>
            events.push(event),
        )

        await integration[0].continuousSync.initDevice()
        await integration[0].continuousSync.enableContinuousSync()

        await integration[1].continuousSync.initDevice()
        await integration[1].continuousSync.enableContinuousSync()

        await clients[0].storageManager
            .collection('test')
            .createObject(TEST_DATA.test1)
        await clients[0].storageManager
            .collection('test')
            .createObject(TEST_DATA.test2)
        await clients[0].storageManager
            .collection('test')
            .createObject(TEST_DATA.test3)

        await integration[0].continuousSync.forceIncrementalSync()
        expect(events).toEqual([
            {
                hasChanges: false,
                error: new Error(
                    'Sync batch size exceeds limit during upload, but cannot make it smaller',
                ),
            },
        ])
    })
})
