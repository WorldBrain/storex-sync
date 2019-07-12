import expect from "expect"
import { setupStorexTest } from "@worldbrain/storex-pattern-modules/lib/index.tests";
import StorageManager from "@worldbrain/storex";
import { FastSyncSenderChannel, FastSyncReceiverChannel, FastSyncBatch } from "./types";
import { FastSyncReceiver, FastSyncSender, FastSyncSenderOptions } from ".";
import { EventEmitter } from "events";
import { ResolvablePromise, resolvablePromise } from "./utils";

describe('Fast initial sync', () => {
    async function setupTest() {
        async function createDevice() {
            const { storageManager, modules } = await setupStorexTest({
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

        function createChannel() {
            // let transmitPromise! : ResolvablePromise<void>
            // let sendPromise = resolvablePromise<void>()

            // resolves when data has been sent, and replaced before yielding data to receivcer
            let sendBatchPromise = resolvablePromise<FastSyncBatch | null>()

            // resolves when data has been received, and replaced right after
            let recvBatchPromise = resolvablePromise<void>()

            const senderChannel : FastSyncSenderChannel = {
                sendSyncInfo: async () => {
                    // transmitPromise = resolvablePromise()
                    // sendPromise.resolve()
                    // await transmitPromise.promise
                    // sendPromise = resolvablePromise<void>()
                },
                sendObjectBatch: async (batch : FastSyncBatch) => {
                    sendBatchPromise.resolve(batch)
                    await recvBatchPromise.promise
                },
                finish: async () => {
                    // console.log('senderChannel.finish()')
                    sendBatchPromise.resolve(null)
                }
            }
            const receiverChannel : FastSyncReceiverChannel = {
                streamObjectBatches: async function* () : AsyncIterableIterator<{collection : string, objects : any[]}> {
                    // console.log('stream: start')
                    while (true) {
                        // console.log('stream: start iter')
                        const batch = await sendBatchPromise.promise
                        if (!batch) {
                            break
                        }
                        sendBatchPromise = resolvablePromise<FastSyncBatch | null>()
                        yield batch
                        recvBatchPromise.resolve()
                        recvBatchPromise = resolvablePromise<void>()
                        // console.log('stream: end iter')
                    }
                    // console.log('stream: end')
                }
            }

            return {
                senderChannel,
                receiverChannel,
                // transmit: () => {
                //     transmitPromise.resolve()
                // },
                // waitForSend: async () => {

                // }
            }
        }

        function createSenderFastSync(options : FastSyncSenderOptions) : FastSyncSender {
            return new FastSyncSender(options)
        }

        function createReceiverFastSync(options : { storageManager : StorageManager, channel : FastSyncReceiverChannel }) : FastSyncReceiver {
            return new FastSyncReceiver(options)
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

        return { createDevice, createChannel, createSenderFastSync, createReceiverFastSync, createEventSpy }
    }

    it('should work', async () => {
        const testSetup = await setupTest()

        const device1 = await testSetup.createDevice()
        const device2 = await testSetup.createDevice()
        await device1.storageManager.collection('test').createObject({ key: 'one', label: 'Foo' })
        await device1.storageManager.collection('test').createObject({ key: 'two', label: 'Bar' })

        const dummyChannel = testSetup.createChannel()
        
        const senderFastSync = testSetup.createSenderFastSync({
            storageManager: device1.storageManager, channel: dummyChannel.senderChannel,
            collections: ['test']
        })
        const receiverFastSync = testSetup.createReceiverFastSync({
            storageManager: device2.storageManager,
            channel: dummyChannel.receiverChannel
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

        expect(await device2.storageManager.collection('test').findObjects({})).toEqual([
            { key: 'one', label: 'Foo' },
            { key: 'two', label: 'Bar' },
        ])
    })
})
