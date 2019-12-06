const wrtc = require('wrtc')
import expect from 'expect'
import { RegistryCollections } from '@worldbrain/storex/lib/registry'
import { setupSyncTestClient, linearTimestampGenerator } from '../index.tests'
import { TEST_DATA } from '../index.test.data'
import { InitialSync } from './initial-sync'
import { ContinuousSync } from './continuous-sync'
import {
    createMemorySharedSyncLog,
    lazyMemorySignalTransportFactory,
} from './index.tests'
import { registerModuleMapCollections } from '@worldbrain/storex-pattern-modules'

describe('Integration helpers', () => {
    async function setupTest(options: { collections: RegistryCollections }) {
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
            })
            initialSync.wrtc = wrtc

            return {
                settings,
                initialSync: initialSync,
                continuousSync: new ContinuousSync({
                    auth: { getUserId: async () => index },
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
                }),
            }
        })

        for (const clientIndex of [0, 1]) {
            await clients[clientIndex].storageManager.finishInitialization()
        }

        const sync = async (options: {
            source: { initialSync: InitialSync }
            target: { initialSync: InitialSync }
        }) => {
            const {
                initialMessage,
            } = await options.source.initialSync.requestInitialSync()
            await options.target.initialSync.answerInitialSync({
                initialMessage,
            })
            for (const client of [options.source, options.target]) {
                await client.initialSync.waitForInitialSync()
            }
        }

        return { clients, integration, sync }
    }

    it('should do a successful two way initial sync through integration classes', async () => {
        const { clients, integration, sync } = await setupTest({
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
        await clients[1].storageManager
            .collection('test')
            .createObject(TEST_DATA.test3)

        integration[0].initialSync.events.once('roleSwitch', event => {
            expect(event).toEqual({
                before: 'receiver',
                after: 'sender',
            })
        })

        await sync({
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
            objects: [
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
            objects: [
                (expect as any).objectContaining(TEST_DATA.test1),
                (expect as any).objectContaining(TEST_DATA.test2),
                (expect as any).objectContaining(TEST_DATA.test3),
            ],
        })
    })
})
