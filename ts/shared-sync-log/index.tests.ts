import * as expect from 'expect'
import { SharedSyncLog, SharedSyncLogEntry } from './types';

export async function runTests(options : {createLog : () => Promise<SharedSyncLog>, cleanUp? : () => Promise<void>}) {
    it('should work', async () => {
        const sharedSyncLog = await options.createLog()
        const userId = 1
        const firstDeviceId = await sharedSyncLog.createDeviceId({ userId, sharedUntil: 2 })
        const secondDeviceId = await sharedSyncLog.createDeviceId({ userId, sharedUntil: 2 })
        
        const entries : SharedSyncLogEntry[] = [
            {userId, deviceId: firstDeviceId, createdOn: 2, sharedOn: 4, data: 'joe-1'},
            {userId, deviceId: firstDeviceId, createdOn: 6, sharedOn: 8, data: 'joe-2'},
        ]
    
        await sharedSyncLog.writeEntries(entries)
        const unseenEntries = await sharedSyncLog.getUnsyncedEntries({ deviceId: secondDeviceId });
        expect(unseenEntries).toEqual([
            expect.objectContaining({...entries[0], userId: 1, deviceId: firstDeviceId}),
            expect.objectContaining({...entries[1], userId: 1, deviceId: firstDeviceId}),
        ])
        await sharedSyncLog.markAsSeen(entries, { deviceId: secondDeviceId })
        expect(await sharedSyncLog.getUnsyncedEntries({ deviceId: secondDeviceId })).toEqual([])
    })

    it('should work correctly even if entries from the past are added', async () => {
        const sharedSyncLog = await options.createLog()
        const userId = 1
        const firstDeviceId = await sharedSyncLog.createDeviceId({ userId, sharedUntil: 2 })
        const secondDeviceId = await sharedSyncLog.createDeviceId({ userId, sharedUntil: 2 })
        
        expect(await sharedSyncLog.getUnsyncedEntries({ deviceId: secondDeviceId })).toEqual([])
        
        const entries : SharedSyncLogEntry[] = [
            {userId, deviceId: firstDeviceId, createdOn: 4, sharedOn: 5, data: 'joe-2'},
            {userId, deviceId: firstDeviceId, createdOn: 6, sharedOn: 8, data: 'joe-3'},
        ]
        await sharedSyncLog.writeEntries(entries)
        await sharedSyncLog.markAsSeen(entries, { deviceId: secondDeviceId })
        
        const newEntries = [
            {userId, deviceId: firstDeviceId, createdOn: 1, sharedOn: 2, data: 'joe-1'},
        ]
        await sharedSyncLog.writeEntries(newEntries)
    
        const unseenEntries = await sharedSyncLog.getUnsyncedEntries({ deviceId: secondDeviceId });
        expect(unseenEntries).toEqual([
            expect.objectContaining({...newEntries[0], userId: 1, deviceId: firstDeviceId}),
        ])
        
        await sharedSyncLog.markAsSeen(unseenEntries, { deviceId: secondDeviceId })
        expect(await sharedSyncLog.getUnsyncedEntries({ deviceId: secondDeviceId })).toEqual([])
    })

    it('should not include its own entries when retrieving unseen entries')
}
