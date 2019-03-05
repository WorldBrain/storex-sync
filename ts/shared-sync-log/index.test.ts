import * as expect from 'expect'
import { setupStorexTest } from "@worldbrain/storex-pattern-modules/lib/index.tests";
import { SharedSyncLogStorage } from ".";
import { SharedSyncLogEntry } from './types';

describe('SharedSyncLogStorage', () => {
    async function setupTest() {
        return setupStorexTest<{sharedSyncLog : SharedSyncLogStorage}>({
            collections: {},
            modules: {
                sharedSyncLog: (({ storageManager }) => new SharedSyncLogStorage({ storageManager }))
            }
        })
    }

    it('should work', async () => {
        const { modules: { sharedSyncLog } } = await setupTest()
        const entries : SharedSyncLogEntry[] = [
            {userId: 'joe', createdOn: 2, sharedOn: 4, data: 'joe-1'},
            {userId: 'joe', createdOn: 6, sharedOn: 8, data: 'joe-2'},
        ]

        const firstDeviceId = await sharedSyncLog.createDeviceId({ userId: 1, sharedUntil: 2 })
        const secondDeviceId = await sharedSyncLog.createDeviceId({ userId: 1, sharedUntil: 2 })
        await sharedSyncLog.writeEntries(entries, { userId: 1, deviceId: firstDeviceId })
        expect(await sharedSyncLog.getUnsyncedEntries({ deviceId: secondDeviceId })).toEqual([
            {...entries[0], userId: 1, deviceId: firstDeviceId, id: 1},
            {...entries[1], userId: 1, deviceId: firstDeviceId, id: 2},
        ])
        await sharedSyncLog.updateSharedUntil({ until: 8, deviceId: secondDeviceId })
        expect(await sharedSyncLog.getUnsyncedEntries({ deviceId: secondDeviceId })).toEqual([])
    })
})
