import * as expect from 'expect'
import { SharedSyncLog, SharedSyncLogEntry } from './types';
import { Omit } from '../types';

export async function runTests(options : {createLog : () => Promise<SharedSyncLog>, cleanUp? : () => Promise<void>}) {
    it('should work', async () => {
        const sharedSyncLog = await options.createLog()
        const userId = 1
        const firstDeviceId = await sharedSyncLog.createDeviceId({ userId, sharedUntil: 2 })
        const secondDeviceId = await sharedSyncLog.createDeviceId({ userId, sharedUntil: 2 })
        
        const entries : Omit<SharedSyncLogEntry, 'sharedOn'>[] = [
            {userId, deviceId: firstDeviceId, createdOn: 2, data: 'joe-1'},
            {userId, deviceId: firstDeviceId, createdOn: 6, data: 'joe-2'},
        ]
    
        await sharedSyncLog.writeEntries(entries)
        const unseenEntries = await sharedSyncLog.getUnsyncedEntries({ userId, deviceId: secondDeviceId });
        expect(unseenEntries).toEqual([
            expect.objectContaining({...entries[0], userId: 1, deviceId: firstDeviceId}),
            expect.objectContaining({...entries[1], userId: 1, deviceId: firstDeviceId}),
        ])
        await sharedSyncLog.markAsSeen(entries, { userId, deviceId: secondDeviceId, now: 10 })
        expect(await sharedSyncLog.getUnsyncedEntries({ userId, deviceId: secondDeviceId })).toEqual([])
    })

    it('should work correctly even if entries from the past are added', async () => {
        const sharedSyncLog = await options.createLog()
        const userId = 1
        const firstDeviceId = await sharedSyncLog.createDeviceId({ userId, sharedUntil: 2 })
        const secondDeviceId = await sharedSyncLog.createDeviceId({ userId, sharedUntil: 2 })
        
        expect(await sharedSyncLog.getUnsyncedEntries({ userId, deviceId: secondDeviceId })).toEqual([])
        
        const entries : Omit<SharedSyncLogEntry, 'sharedOn'>[] = [
            {userId, deviceId: firstDeviceId, createdOn: 4, data: 'joe-2'},
            {userId, deviceId: firstDeviceId, createdOn: 6, data: 'joe-3'},
        ]
        await sharedSyncLog.writeEntries(entries, { now: 8 })
        await sharedSyncLog.markAsSeen(entries, { userId, deviceId: secondDeviceId })
        
        const newEntries : Omit<SharedSyncLogEntry, 'sharedOn'>[] = [
            {userId, deviceId: firstDeviceId, createdOn: 1, data: 'joe-1'},
        ]
        await sharedSyncLog.writeEntries(newEntries, { now: 10 })
    
        const unseenEntries = await sharedSyncLog.getUnsyncedEntries({ userId, deviceId: secondDeviceId });
        expect(unseenEntries).toEqual([
            expect.objectContaining({...newEntries[0], userId: 1, deviceId: firstDeviceId}),
        ])
        
        await sharedSyncLog.markAsSeen(unseenEntries, { userId, deviceId: secondDeviceId })
        expect(await sharedSyncLog.getUnsyncedEntries({ userId, deviceId: secondDeviceId })).toEqual([])
    })

    it('should not include its own entries when retrieving unseen entries')
}
