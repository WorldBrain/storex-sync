import expect from 'expect'
import { EventEmitter } from 'events'
import { setupStorexTest } from '@worldbrain/storex-pattern-modules/lib/index.tests'
const wrtc = require('wrtc')
import Peer from 'simple-peer'
import { MemorySignalTransportManager } from 'simple-signalling/lib/memory'
import { FirebaseSignalTransport } from 'simple-signalling/lib/firebase'
import { createSignallingFirebaseTestApp } from 'simple-signalling/lib/firebase.tests'
import { signalSimplePeer } from 'simple-signalling/lib/simple-peer'
import { FastSync, FastSyncPreSendProcessor } from '.'
import {
    createMemoryChannel,
    // WebRTCFastSyncSenderChannel,
    // WebRTCFastSyncReceiverChannel,
    MemoryFastSyncChannel,
    WebRTCFastSyncChannel,
} from './channels'
import { FastSyncChannel } from './types'
import { SignalTransport } from 'simple-signalling/lib/types'
import { FAST_SYNC_TEST_DATA } from './index.test.data'
import { resolvablePromise } from './utils'

interface TestOptions {
    createChannels: () => Promise<{
        senderChannel: FastSyncChannel
        receiverChannel: FastSyncChannel
    }>
    preSendProcessor?: FastSyncPreSendProcessor
}
type TestRunner = (
    test: (options: TestOptions) => Promise<void>,
    options: { skip: () => void },
) => Promise<void>

async function setupTest(options: TestOptions) {
    async function createDevice() {
        const { storageManager } = await setupStorexTest({
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
            modules: {},
        })

        return { storageManager }
    }

    function createEventSpy() {
        let emittedEvents: Array<{ eventName: string; [key: string]: any }> = []
        const listen = (events: EventEmitter) => {
            const emit = events.emit.bind(events)
            events.emit = ((eventName: string, event: any) => {
                emittedEvents.push({ eventName, ...event })
                emit(eventName, event)
            }) as any
        }
        const popEvents = () => {
            const poppedEvents = emittedEvents
            emittedEvents = []
            return poppedEvents
        }
        return { events: emittedEvents, listen, popEvents }
    }

    return {
        createDevice,
        createChannels: options.createChannels,
        createEventSpy,
    }
}

async function createWebRTCSyncChannels(options: {
    transports: [SignalTransport, SignalTransport]
}) {
    const { transports } = options
    const { initialMessage } = await transports[0].allocateChannel()
    const channels = [
        await transports[0].openChannel({
            initialMessage,
            deviceId: 'first',
        }),
        await transports[1].openChannel({
            initialMessage,
            deviceId: 'second',
        }),
    ]
    await Promise.all(channels.map(channel => channel.connect()))

    const peers = [new Peer({ initiator: true, wrtc }), new Peer({ wrtc })]
    await Promise.all([
        signalSimplePeer({
            signalChannel: channels[0],
            simplePeer: peers[0],
            reporter: (eventName, event) => {
                // console.log('peer 0', eventName, event)
            },
        }),
        signalSimplePeer({
            signalChannel: channels[1],
            simplePeer: peers[1],
            reporter: (eventName, event) => {
                // console.log('peer 1', eventName, event)
            },
        }),
    ])

    return {
        senderChannel: new WebRTCFastSyncChannel({ peer: peers[0] }),
        receiverChannel: new WebRTCFastSyncChannel({
            peer: peers[1],
        }),
    }
}

async function setupMinimalTest(options: TestOptions) {
    const testSetup = await setupTest(options)
    const device1 = await testSetup.createDevice()
    const device2 = await testSetup.createDevice()
    const { object: object1 } = await device1.storageManager
        .collection('test')
        .createObject(FAST_SYNC_TEST_DATA.test1)
    const { object: object2 } = await device1.storageManager
        .collection('test')
        .createObject(FAST_SYNC_TEST_DATA.test2)

    const channels = await testSetup.createChannels()
    const senderFastSync = new FastSync({
        storageManager: device1.storageManager,
        channel: channels.senderChannel,
        collections: ['test'],
        preSendProcessor: options.preSendProcessor,
    })
    const receiverFastSync = new FastSync({
        storageManager: device2.storageManager,
        channel: channels.receiverChannel,
        collections: ['test'],
        preSendProcessor: options.preSendProcessor,
    })

    const senderEventSpy = testSetup.createEventSpy()
    const receiverEventSpy = testSetup.createEventSpy()

    senderEventSpy.listen(senderFastSync.events as EventEmitter)
    receiverEventSpy.listen(receiverFastSync.events as EventEmitter)

    const sync = async (options?: { bothWays?: boolean }) => {
        const senderPromise = senderFastSync.execute({
            role: 'sender',
            ...options,
        })
        const receiverPromise = receiverFastSync.execute({
            role: 'receiver',
            ...options,
        })

        await receiverPromise
        await senderPromise

        await channels.senderChannel.destroy()
        await channels.receiverChannel.destroy()
    }

    return {
        ...testSetup,
        senderFastSync,
        receiverFastSync,
        channels,
        object1,
        object2,
        device1,
        device2,
        senderEventSpy,
        receiverEventSpy,
        sync,
    }
}

function makeTestFactory(runner: TestRunner) {
    return (
        description: string,
        test: (options: TestOptions) => Promise<void>,
    ) => {
        it(description, async function() {
            await runner(test, { skip: () => this.skip() })
        })
    }
}

describe('Fast initial sync', () => {
    function runTests(runner: TestRunner) {
        const it = makeTestFactory(runner)

        it('should work with a very minimal test', async (options: TestOptions) => {
            const setup = await setupMinimalTest(options)

            const firstReceivedMessagePromise = setup.channels.receiverChannel.receiveUserPackage()
            await setup.channels.senderChannel.sendUserPackage({
                type: 'secret-key',
                key: '5555',
            })
            expect(await firstReceivedMessagePromise).toEqual({
                type: 'secret-key',
                key: '5555',
            })

            const secondReceivedMessagePromise = setup.channels.senderChannel.receiveUserPackage()
            await setup.channels.receiverChannel.sendUserPackage({
                type: 'device-info',
                productType: 'app',
            })
            expect(await secondReceivedMessagePromise).toEqual({
                type: 'device-info',
                productType: 'app',
            })

            await setup.sync()

            const expectedSyncInfo = {
                collectionCount: 1,
                objectCount: 2,
            }
            const allExpectedEvents = [
                {
                    eventName: 'prepared',
                    syncInfo: {
                        ...expectedSyncInfo,
                    },
                },
                {
                    eventName: 'progress',
                    progress: {
                        ...expectedSyncInfo,
                        totalObjectsProcessed: 0,
                    },
                },
                {
                    eventName: 'progress',
                    progress: {
                        ...expectedSyncInfo,
                        totalObjectsProcessed: 1,
                    },
                },
                {
                    eventName: 'progress',
                    progress: {
                        ...expectedSyncInfo,
                        totalObjectsProcessed: 2,
                    },
                },
            ]
            expect(setup.senderEventSpy.popEvents()).toEqual(allExpectedEvents)
            expect(setup.receiverEventSpy.popEvents()).toEqual(
                allExpectedEvents,
            )

            expect(
                await setup.device2.storageManager
                    .collection('test')
                    .findObjects({}),
            ).toEqual([
                {
                    key: 'one',
                    label: 'Foo',
                    createdWhen: setup.object1.createdWhen,
                },
                {
                    key: 'two',
                    label: 'Bar',
                    createdWhen: setup.object2.createdWhen,
                },
            ])
        })

        it('should be able to filter out data to send', async (options: TestOptions) => {
            const setup = await setupMinimalTest({
                ...options,
                preSendProcessor: async params => {
                    if (params.object.label === 'Foo') {
                        return params
                    } else {
                        return { object: null }
                    }
                },
            })
            await setup.sync()

            expect(
                await setup.device2.storageManager
                    .collection('test')
                    .findObjects({}),
            ).toEqual([
                {
                    key: 'one',
                    label: 'Foo',
                    createdWhen: setup.object1.createdWhen,
                },
            ])
        })

        it('should support two way sync', async (options: TestOptions) => {
            const setup = await setupMinimalTest(options)

            await setup.device2.storageManager
                .collection('test')
                .createObject(FAST_SYNC_TEST_DATA.test3)

            await setup.sync({ bothWays: true })

            expect({
                device: 'two',
                objects: await setup.device2.storageManager
                    .collection('test')
                    .findObjects({}, { order: [['createdWhen', 'asc']] }),
            }).toEqual({
                device: 'two',
                objects: [
                    (expect as any).objectContaining(FAST_SYNC_TEST_DATA.test1),
                    (expect as any).objectContaining(FAST_SYNC_TEST_DATA.test2),
                    (expect as any).objectContaining(FAST_SYNC_TEST_DATA.test3),
                ],
            })

            expect({
                device: 'one',
                objects: await setup.device1.storageManager
                    .collection('test')
                    .findObjects({}, { order: [['createdWhen', 'asc']] }),
            }).toEqual({
                device: 'one',
                objects: [
                    (expect as any).objectContaining(FAST_SYNC_TEST_DATA.test1),
                    (expect as any).objectContaining(FAST_SYNC_TEST_DATA.test2),
                    (expect as any).objectContaining(FAST_SYNC_TEST_DATA.test3),
                ],
            })
        })

        it('should be able to pause sending', async (options: TestOptions) => {
            const setup = await setupMinimalTest(options)

            const firstObjectSent = resolvablePromise<void>()
            setup.senderFastSync.events.on('progress', ({ progress }) => {
                if (progress.totalObjectsProcessed === 1) {
                    setup.senderFastSync.pause()
                    firstObjectSent.resolve()
                }
            })
            const syncPromise = setup.sync()

            await firstObjectSent.promise
            expect(setup.senderEventSpy.popEvents()).toEqual([
                (expect as any).objectContaining({ eventName: 'prepared' }),
                (expect as any).objectContaining({ eventName: 'progress' }),
                (expect as any).objectContaining({ eventName: 'progress' }),
                (expect as any).objectContaining({ eventName: 'paused' }),
            ])
            expect(setup.senderFastSync.state).toBe('paused')
            await new Promise(resolve => setTimeout(resolve, 200))
            expect(setup.receiverFastSync.state).toBe('paused')
            expect(setup.receiverEventSpy.popEvents()).toEqual([
                (expect as any).objectContaining({ eventName: 'prepared' }),
                (expect as any).objectContaining({ eventName: 'progress' }),
                (expect as any).objectContaining({ eventName: 'progress' }),
                (expect as any).objectContaining({ eventName: 'paused' }),
            ])
            expect(
                await setup.device2.storageManager
                    .collection('test')
                    .findObjects({}),
            ).toEqual([
                {
                    key: 'one',
                    label: 'Foo',
                    createdWhen: setup.object1.createdWhen,
                },
            ])

            setup.senderFastSync.resume()
            await syncPromise
            expect(
                await setup.device2.storageManager
                    .collection('test')
                    .findObjects({}),
            ).toEqual([
                {
                    key: 'one',
                    label: 'Foo',
                    createdWhen: setup.object1.createdWhen,
                },
                {
                    key: 'two',
                    label: 'Bar',
                    createdWhen: setup.object2.createdWhen,
                },
            ])
        })

        it('should be able to cancel sending', async (options: TestOptions) => {
            const setup = await setupMinimalTest(options)
            setup.senderFastSync.events.on('progress', ({ progress }) => {
                if (progress.totalObjectsProcessed === 1) {
                    setup.senderFastSync.cancel()
                }
            })
            const syncPromise = setup.sync()

            await syncPromise
            expect(
                await setup.device2.storageManager
                    .collection('test')
                    .findObjects({}),
            ).toEqual([
                {
                    key: 'one',
                    label: 'Foo',
                    createdWhen: setup.object1.createdWhen,
                },
            ])
        })

        it('must detect on the receiver side the connection has stalled', async options => {
            const setup = await setupMinimalTest(options)
            setup.channels.receiverChannel.timeoutInMiliseconds = 100
            setup.channels.senderChannel.preSend = async () => {
                return new Promise(resolve => setTimeout(resolve, 500))
            }
            const syncPromise = setup.sync()
            await new Promise(resolve => setTimeout(resolve, 1000))
            try {
                expect(setup.receiverEventSpy.popEvents()).toEqual([
                    (expect as any).objectContaining({ eventName: 'stalled' }),
                    (expect as any).objectContaining({ eventName: 'prepared' }),
                    (expect as any).objectContaining({ eventName: 'progress' }),
                    (expect as any).objectContaining({ eventName: 'stalled' }),
                ])
            } finally {
                await setup.senderFastSync.cancel()
                await syncPromise
            }
        })

        it('must detect on the sender side the connection has stalled', async options => {
            const setup = await setupMinimalTest(options)
            setup.channels.senderChannel.timeoutInMiliseconds = 100
            setup.channels.receiverChannel.postReceive = async () => {
                return new Promise(resolve => setTimeout(resolve, 400))
            }
            const syncPromise = setup.sync()
            await new Promise(resolve => setTimeout(resolve, 1000))
            try {
                expect(setup.senderEventSpy.popEvents()).toEqual([
                    (expect as any).objectContaining({ eventName: 'prepared' }),
                    (expect as any).objectContaining({ eventName: 'progress' }),
                    (expect as any).objectContaining({ eventName: 'stalled' }),
                    (expect as any).objectContaining({ eventName: 'progress' }),
                    (expect as any).objectContaining({ eventName: 'stalled' }),
                    (expect as any).objectContaining({ eventName: 'progress' }),
                    (expect as any).objectContaining({ eventName: 'stalled' }),
                ])
            } finally {
                await setup.senderFastSync.cancel()
                await syncPromise
            }
        })
    }

    describe('in-memory data channel', () => {
        runTests(async test => {
            await test({
                createChannels: async () => createMemoryChannel(),
            })
        })
    })

    describe('WebRTC data channel with in-memory signalling', async () => {
        runTests(async (test, options) => {
            if (process.env.SKIP_WEBRTC_TESTS === 'true') {
                options.skip()
            }

            await test({
                createChannels: async () => {
                    const transportManager = new MemorySignalTransportManager()
                    const transports: [SignalTransport, SignalTransport] = [
                        transportManager.createTransport(),
                        transportManager.createTransport(),
                    ]
                    return createWebRTCSyncChannels({ transports })
                },
            })
        })
    })

    describe('WebRTC data channel with Firebase signalling', async function() {
        runTests(async (test, options) => {
            if (
                process.env.SKIP_WEBRTC_TESTS === 'true' ||
                process.env.TEST_FIREBASE_SIGNALLING !== 'true'
            ) {
                options.skip()
            }

            const {
                app: firebaseApp,
                collectionName,
            } = await createSignallingFirebaseTestApp()
            try {
                await test({
                    createChannels: async () => {
                        const createTransport = () =>
                            new FirebaseSignalTransport({
                                database: firebaseApp.database(),
                                collectionName,
                            })
                        const transports: [SignalTransport, SignalTransport] = [
                            createTransport(),
                            createTransport(),
                        ]
                        return createWebRTCSyncChannels({ transports })
                    },
                })
            } finally {
                await firebaseApp.delete()
            }
        })
    })
})
