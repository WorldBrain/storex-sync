import expect from 'expect'
import { SharedSyncLog, SharedSyncLogEntry } from './types'
import { Omit } from '../types'

export async function runTests(options: {
    createLog: () => Promise<SharedSyncLog>
    cleanUp?: () => Promise<void>
}) {
    it('should work', async () => {
        const sharedSyncLog = await options.createLog()
        const userId = 1
        const firstDeviceId = await sharedSyncLog.createDeviceId({
            userId,
            sharedUntil: 2,
        })
        const secondDeviceId = await sharedSyncLog.createDeviceId({
            userId,
            sharedUntil: 2,
        })

        const entries: Omit<SharedSyncLogEntry, 'sharedOn'>[] = [
            { userId, deviceId: firstDeviceId, createdOn: 2, data: 'joe-1' },
            { userId, deviceId: firstDeviceId, createdOn: 6, data: 'joe-2' },
        ]

        await sharedSyncLog.writeEntries(entries, {
            userId,
            deviceId: firstDeviceId,
        })
        const logUpdate = await sharedSyncLog.getUnsyncedEntries({
            userId,
            deviceId: secondDeviceId,
        })
        expect(logUpdate).toEqual({ entries: [
            (expect as any).objectContaining({
                ...entries[0],
                userId: 1,
                deviceId: firstDeviceId,
            }),
            (expect as any).objectContaining({
                ...entries[1],
                userId: 1,
                deviceId: firstDeviceId,
            }),
        ]})
        await sharedSyncLog.markAsSeen(logUpdate, {
            userId,
            deviceId: secondDeviceId,
            now: 10,
        })
        expect(
            await sharedSyncLog.getUnsyncedEntries({
                userId,
                deviceId: secondDeviceId,
            }),
        ).toEqual({ entries: [] })
    })

    it('should work correctly even if entries from the past are added', async () => {
        const sharedSyncLog = await options.createLog()
        const userId = 1
        const firstDeviceId = await sharedSyncLog.createDeviceId({
            userId,
            sharedUntil: 2,
        })
        const secondDeviceId = await sharedSyncLog.createDeviceId({
            userId,
            sharedUntil: 2,
        })

        expect(
            await sharedSyncLog.getUnsyncedEntries({
                userId,
                deviceId: secondDeviceId,
            }),
        ).toEqual({ entries: [] })

        const entries: Omit<SharedSyncLogEntry, 'sharedOn' | 'userId'>[] = [
            { deviceId: firstDeviceId, createdOn: 4, data: 'joe-2' },
            { deviceId: firstDeviceId, createdOn: 6, data: 'joe-3' },
        ]
        await sharedSyncLog.writeEntries(entries, {
            userId,
            deviceId: firstDeviceId,
            now: 8,
        })

        const firstLogUpdate = await sharedSyncLog.getUnsyncedEntries({ userId, deviceId: secondDeviceId })
        await sharedSyncLog.markAsSeen(firstLogUpdate, {
            userId,
            deviceId: secondDeviceId,
        })

        const newEntries: Omit<SharedSyncLogEntry, 'sharedOn' | 'userId'>[] = [
            { deviceId: firstDeviceId, createdOn: 1, data: 'joe-1' },
        ]
        await sharedSyncLog.writeEntries(newEntries, {
            userId,
            deviceId: firstDeviceId,
            now: 10,
        })

        const secondLogUpdate = await sharedSyncLog.getUnsyncedEntries({
            userId,
            deviceId: secondDeviceId,
        })
        expect(secondLogUpdate).toEqual({ entries: [
            (expect as any).objectContaining({
                ...newEntries[0],
                userId: 1,
                deviceId: firstDeviceId,
            }),
        ]})

        await sharedSyncLog.markAsSeen(secondLogUpdate, {
            userId,
            deviceId: secondDeviceId,
        })
        expect(
            await sharedSyncLog.getUnsyncedEntries({
                userId,
                deviceId: secondDeviceId,
            }),
        ).toEqual({ entries: [] })
    })

    it('should not include its own entries when retrieving unseen entries', async () => {
        const sharedSyncLog = await options.createLog()
        const userId = 1
        const firstDeviceId = await sharedSyncLog.createDeviceId({
            userId,
            sharedUntil: 2,
        })

        expect(
            await sharedSyncLog.getUnsyncedEntries({
                userId,
                deviceId: firstDeviceId,
            }),
        ).toEqual({ entries: [] })

        const entries: Omit<SharedSyncLogEntry, 'sharedOn' | 'userId'>[] = [
            { deviceId: firstDeviceId, createdOn: 4, data: 'joe-2' },
            { deviceId: firstDeviceId, createdOn: 6, data: 'joe-3' },
        ]
        await sharedSyncLog.writeEntries(entries, {
            userId,
            deviceId: firstDeviceId,
            now: 8,
        })

        const unseenEntries = await sharedSyncLog.getUnsyncedEntries({
            userId,
            deviceId: firstDeviceId,
        })
        expect(unseenEntries).toEqual({ entries: [] })
    })

    it(`should keep giving me old entries as long as I don't mark retrieved entries as seen`, async () => {
        const sharedSyncLog = await options.createLog()
        const userId = 1
        const firstDeviceId = await sharedSyncLog.createDeviceId({
            userId,
            sharedUntil: 2,
        })
        const secondDeviceId = await sharedSyncLog.createDeviceId({
            userId,
            sharedUntil: 2,
        })

        const entries: Omit<SharedSyncLogEntry, 'sharedOn'>[] = [
            { userId, deviceId: firstDeviceId, createdOn: 2, data: 'joe-1' },
            { userId, deviceId: firstDeviceId, createdOn: 6, data: 'joe-2' },
        ]

        await sharedSyncLog.writeEntries(entries, {
            userId,
            deviceId: firstDeviceId,
        })
        const firstLogUpdate = await sharedSyncLog.getUnsyncedEntries({
            userId,
            deviceId: secondDeviceId,
        })
        expect(firstLogUpdate).toEqual({ entries: [
            (expect as any).objectContaining({
                ...entries[0],
                userId: 1,
                deviceId: firstDeviceId,
            }),
            (expect as any).objectContaining({
                ...entries[1],
                userId: 1,
                deviceId: firstDeviceId,
            }),
        ] })

        const secondLogUpdate = await sharedSyncLog.getUnsyncedEntries({
            userId,
            deviceId: secondDeviceId,
        })
        expect(secondLogUpdate).toEqual({ entries: [
            (expect as any).objectContaining({
                ...entries[0],
                userId: 1,
                deviceId: firstDeviceId,
            }),
            (expect as any).objectContaining({
                ...entries[1],
                userId: 1,
                deviceId: firstDeviceId,
            }),
        ] })
    })

    it(`should retrieve entries added between when a device fetches new entries and marks them as read`, async () => {
        const sharedSyncLog = await options.createLog()
        const userId = 1
        const firstDeviceId = await sharedSyncLog.createDeviceId({
            userId,
            sharedUntil: 2,
        })
        const secondDeviceId = await sharedSyncLog.createDeviceId({
            userId,
            sharedUntil: 2,
        })

        const firstBatch: Omit<SharedSyncLogEntry, 'sharedOn'>[] = [
            { userId, deviceId: firstDeviceId, createdOn: 2, data: 'joe-1' },
            { userId, deviceId: firstDeviceId, createdOn: 6, data: 'joe-2' },
        ]
        await sharedSyncLog.writeEntries(firstBatch, {
            userId,
            deviceId: firstDeviceId,
        })
        const firstLogUpdate = await sharedSyncLog.getUnsyncedEntries({
            userId,
            deviceId: secondDeviceId,
        })
        expect(firstLogUpdate).toEqual({ entries: [
            (expect as any).objectContaining({
                ...firstBatch[0],
                userId: 1,
                deviceId: firstDeviceId,
            }),
            (expect as any).objectContaining({
                ...firstBatch[1],
                userId: 1,
                deviceId: firstDeviceId,
            }),
        ] })

        const secondBatch: Omit<SharedSyncLogEntry, 'sharedOn'>[] = [
            { userId, deviceId: firstDeviceId, createdOn: 8, data: 'joe-3' },
            { userId, deviceId: firstDeviceId, createdOn: 10, data: 'joe-4' },
        ]
        await sharedSyncLog.writeEntries(secondBatch, {
            userId,
            deviceId: firstDeviceId,
        })
        await sharedSyncLog.markAsSeen(firstLogUpdate, {
            userId,
            deviceId: secondDeviceId,
        })

        const secondLogUpdate = await sharedSyncLog.getUnsyncedEntries({
            userId,
            deviceId: secondDeviceId,
        })
        expect(secondLogUpdate).toEqual({ entries: [
            (expect as any).objectContaining({
                ...secondBatch[0],
                userId: 1,
                deviceId: firstDeviceId,
            }),
            (expect as any).objectContaining({
                ...secondBatch[1],
                userId: 1,
                deviceId: firstDeviceId,
            }),
        ] })
    })
}
