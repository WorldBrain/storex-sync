import expect from "expect"
import { EventEmitter } from "events";
import { setupStorexTest } from "@worldbrain/storex-pattern-modules/lib/index.tests";
const wrtc = require('wrtc')
import Peer from 'simple-peer'
import { MemorySignalTransportManager } from "simple-signalling/lib/memory"
import { FirebaseSignalTransport } from "simple-signalling/lib/firebase"
import { createSignallingFirebaseTestApp } from "simple-signalling/lib/firebase.tests"
import { signalSimplePeer } from "simple-signalling/lib/simple-peer"
import { FastSyncReceiver, FastSyncSender } from ".";
import { createMemoryChannel, WebRTCFastSyncSenderChannel, WebRTCFastSyncReceiverChannel } from "./channels";
import { FastSyncSenderChannel, FastSyncReceiverChannel } from "./types";
import { SignalTransport } from "simple-signalling/lib/types";

describe('Fast initial sync', () => {
    interface SetupTestOptions {
        createChannels : () => Promise<{ senderChannel: FastSyncSenderChannel, receiverChannel: FastSyncReceiverChannel }>
    }

    async function setupTest(options : SetupTestOptions) {
        async function createDevice() {
            const { storageManager } = await setupStorexTest({
                collections: {
                    test: {
                        version: new Date(),
                        fields: {
                            key: { type: 'string' },
                            label: { type: 'string' }
                        },
                        indices: [{ field: 'key', pk: true }]
                    }
                },
                modules: {}
            })

            return { storageManager }
        }

        function createEventSpy() {
            let events : any[][] = []
            const listener = (event : string) => {
                return (...args : any[]) => {
                    events.push([event, args])
                }
            }
            const listen = (events : EventEmitter, eventNames : string[]) => {
                for (const event of eventNames) {
                    events.on(event, listener(event))
                }
            }
            const popEvents = () => {
                const poppedEvents = events
                events = []
                return poppedEvents
            }
            return { events, listen, popEvents }
        }

        return { createDevice, createChannels: createMemoryChannel, createEventSpy }
    }

    async function createWebRTCSyncChannels(options : { transports : [SignalTransport, SignalTransport] }) {
        const { transports } = options
        const { initialMessage } = await transports[0].allocateChannel()
        const channels = [
            await transports[0].openChannel({ initialMessage, deviceId: 'device one' }),
            await transports[1].openChannel({ initialMessage, deviceId: 'device two' }),
        ]
        const peers = [
            new Peer({ initiator: true, wrtc }),
            new Peer({ wrtc }),
        ]
        await Promise.all([
            signalSimplePeer({ signalChannel: channels[0], simplePeer: peers[0] }),
            signalSimplePeer({ signalChannel: channels[1], simplePeer: peers[1] }),
        ])

        return {
            senderChannel: new WebRTCFastSyncSenderChannel({ peer: peers[0] }),
            receiverChannel: new WebRTCFastSyncReceiverChannel({ peer: peers[1] }),
        }
    }

    async function runMinimalTest(options : SetupTestOptions) {
        const testSetup = await setupTest(options)

        const device1 = await testSetup.createDevice()
        const device2 = await testSetup.createDevice()
        await device1.storageManager.collection('test').createObject({ key: 'one', label: 'Foo' })
        await device1.storageManager.collection('test').createObject({ key: 'two', label: 'Bar' })

        const channels = testSetup.createChannels()
        const senderFastSync = new FastSyncSender({
            storageManager: device1.storageManager, channel: channels.senderChannel,
            collections: ['test']
        })
        const receiverFastSync = new FastSyncReceiver({
            storageManager: device2.storageManager,
            channel: channels.receiverChannel
        })

        const senderEventSpy = testSetup.createEventSpy()
        const receiverEventSpy = testSetup.createEventSpy()

        senderEventSpy.listen(senderFastSync.events as EventEmitter, ['prepared'])
        receiverEventSpy.listen(senderFastSync.events as EventEmitter, ['prepared'])

        const senderPromise = senderFastSync.execute()
        const receiverPromise = receiverFastSync.execute()

        // await dummyChannel.waitForSend()
        // dummyChannel.transmit()

        await receiverPromise
        await senderPromise

        expect(senderEventSpy.popEvents()).toEqual([
            ['prepared', [{
                syncInfo: {
                    collectionCount: 1,
                    objectCount: 2,
                }
            }]]
        ])

        expect(receiverEventSpy.popEvents()).toEqual([
            ['prepared', [{
                syncInfo: {
                    collectionCount: 1,
                    objectCount: 2,
                }
            }]]
        ])

        expect(await device2.storageManager.collection('test').findObjects({})).toEqual([
            { key: 'one', label: 'Foo' },
            { key: 'two', label: 'Bar' },
        ])
    }

    it('should work with a very minimal example over an in-memory data channel', async () => {
        await runMinimalTest({ createChannels: async () => createMemoryChannel() })
    })

    it('should work with a very minimal example over a WebRTC data channel with in-memory signalling', async () => {
        await runMinimalTest({ createChannels: async () => {
            const transportManager = new MemorySignalTransportManager()
            const transports : [SignalTransport, SignalTransport] = [
                transportManager.createTransport(), transportManager.createTransport()
            ]
            return createWebRTCSyncChannels({ transports })
        } })
    })

    it('should work with a very minimal example over a WebRTC data channel with Firebase signalling', async function() {
        if (process.env.TEST_FIREBASE_SIGNALLING !== 'true') {
            this.skip()
        }

        const { app: firebaseApp, collectionName } = await createSignallingFirebaseTestApp()
        try {
            await runMinimalTest({ createChannels: async () => {
                const createTransport = () => new FirebaseSignalTransport({ database: firebaseApp.database(), collectionName })
                const transports : [SignalTransport, SignalTransport] = [
                    createTransport(), createTransport(),
                ]
                return createWebRTCSyncChannels({ transports })
            } })
        } finally {
            await firebaseApp.delete()
        }
    })
})
