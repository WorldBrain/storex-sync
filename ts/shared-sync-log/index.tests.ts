import * as expect from 'expect'
import { SharedSyncLog, SharedSyncLogEntry } from './types'

export async function runTests(options: {
    createLog: () => Promise<SharedSyncLog>
    cleanUp?: () => Promise<void>
}) {
    it('should work', async () => {
        const sharedSyncLog = await options.createLog()
        const entries: SharedSyncLogEntry[] = [
            {
                userId: 'joe',
                deviceId: 'joe1',
                createdOn: 2,
                sharedOn: 4,
                data: 'joe-1',
            },
            {
                userId: 'joe',
                deviceId: 'joe1',
                createdOn: 6,
                sharedOn: 8,
                data: 'joe-2',
            },
        ]

        const firstDeviceId = await sharedSyncLog.createDeviceId({
            userId: 1,
            sharedUntil: 2,
        })
        const secondDeviceId = await sharedSyncLog.createDeviceId({
            userId: 1,
            sharedUntil: 2,
        })
        await sharedSyncLog.writeEntries(entries, {
            userId: 1,
            deviceId: firstDeviceId,
        })
        expect(
            await sharedSyncLog.getUnsyncedEntries({
                deviceId: secondDeviceId,
            }),
        ).toEqual([
            { ...entries[0], userId: 1, deviceId: firstDeviceId, id: 1 },
            { ...entries[1], userId: 1, deviceId: firstDeviceId, id: 2 },
        ])
        await sharedSyncLog.updateSharedUntil({
            until: 8,
            deviceId: secondDeviceId,
        })
        expect(
            await sharedSyncLog.getUnsyncedEntries({
                deviceId: secondDeviceId,
            }),
        ).toEqual([])
    })
}
