import StorageManager from "@worldbrain/storex"
import { ClientSyncLogStorage } from "./client-sync-log"
import { SharedSyncLog } from "./shared-sync-log"
import { ReconcilerFunction, ExecutableOperation } from "./reconciliation"

export async function shareLogEntries(args : {clientSyncLog : ClientSyncLogStorage, sharedSyncLog : SharedSyncLog, userId, deviceId, now : number}) {
    const entries = await args.clientSyncLog.getUnsharedEntries()
    const sharedLogEntries = entries.map(entry => ({
        userId: args.userId,
        deviceId: args.deviceId,
        createdOn: entry.createdOn,
        sharedOn: args.now,
        data: JSON.stringify({
            operation: entry.operation,
            collection: entry.collection,
            pk: entry.pk,
            field: entry['field'] || null,
            value: entry['value'] || null,
        })
    }))
    await args.sharedSyncLog.writeEntries(sharedLogEntries, { now: args.now })
    await args.clientSyncLog.updateSharedUntil({ until: args.now, sharedOn: args.now })
}

export async function receiveLogEntries(args : {
    clientSyncLog : ClientSyncLogStorage, sharedSyncLog : SharedSyncLog,
    userId : number | string,
    deviceId : number | string,
    now : number
}) {
    const entries = await args.sharedSyncLog.getUnsyncedEntries({ userId: args.userId, deviceId: args.deviceId })
    await args.clientSyncLog.insertReceivedEntries(entries, {now: args.now})
    await args.sharedSyncLog.markAsSeen(entries, { userId: args.userId, deviceId: args.deviceId })
}

export async function writeReconcilation(args : {
    storageManager : StorageManager,
    reconciliation : ExecutableOperation[]
}) {
    await args.storageManager.backend.operation('executeBatch', args.reconciliation.map(step => ({
        ...step,
        placeholder: '',
    })))
}

export async function doSync({clientSyncLog, sharedSyncLog, storageManager, reconciler, now, userId, deviceId} : {
    clientSyncLog : ClientSyncLogStorage,
    sharedSyncLog : SharedSyncLog,
    storageManager : StorageManager,
    reconciler : ReconcilerFunction,
    now : number,
    userId,
    deviceId,
}) {
    await receiveLogEntries({clientSyncLog, sharedSyncLog, userId, deviceId, now})
    await shareLogEntries({clientSyncLog, sharedSyncLog, userId, deviceId, now})
    
    while (true) {
        const entries = await clientSyncLog.getNextEntriesToIntgrate()
        if (!entries) {
            break
        }

        const reconciliation = await reconciler(entries, {storageRegistry: storageManager.registry})
        await writeReconcilation({storageManager, reconciliation})
        await clientSyncLog.markAsIntegrated(entries)
    }
}
