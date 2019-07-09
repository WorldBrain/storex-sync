import { setupStorexTest } from "@worldbrain/storex-pattern-modules/lib/index.tests";
import StorageManager from "@worldbrain/storex";
import { FastSyncSenderChannel, FastSyncReceiverChannel } from "./types";
import { FastSyncReceiver, FastSyncSender } from ".";

describe('Fast initial sync', () => {
    async function setupTest() {
        async function createDevice() {
            const { storageManager, modules } = await setupStorexTest({
                collections: {
                    test: {
                        version: new Date(),
                        fields: {
                            label: { type: 'string' }
                        }
                    }
                },
                modules: {}
            })

            return { storageManager }
        }

        function createChannel() {
            return {
                senderChannel: null,
                receiverChannel: null,
            }
        }

        function createSenderFastSync(storageManager : StorageManager, options : { channel : FastSyncSenderChannel }) : FastSyncSender {
            return new FastSyncSender({ storageManager, ...options })
        }

        function createReceiverFastSync(storageManager : StorageManager, options : { channel : FastSyncReceiverChannel }) : FastSyncReceiver {
            return new FastSyncReceiver({ storageManager, ...options })
        }

        function createEventSpy() {

        }

        return { createDevice, createChannel, createSenderFastSync, createReceiverFastSync, createEventSpy }
    }

    it('should work', async () => {
        const testSetup = await setupTest()

        const device1 = await testSetup.createDevice()
        const device2 = await testSetup.createDevice()
        await device1.storageManager.collection('test').createObject({ label: 'Foo' })
        await device1.storageManager.collection('test').createObject({ label: 'Bar' })

        const dummyChannel = testSetup.createChannel()
        const senderChannel = dummyChannel.senderChannel
        const receiverChannel = dummyChannel.receiverChannel

        const senderFastSync = testSetup.createSenderFastSync(device1.storageManager, { channel: senderChannel })
        const receiverFastSync = testSetup.createReceiverFastSync(device2.storageManager, { channel: receiverChannel })
        senderFastSync.execute()
        await receiverFastSync.execute()
    })
})
