import StorageManager from "@worldbrain/storex"
import { ClientSyncLogStorage } from "./client-sync-log"
import { ClientSyncLogEntry } from "./client-sync-log/types"
import { SharedSyncLog } from "./shared-sync-log"
import { ReconcilerFunction, ExecutableOperation } from "./reconciliation"

export async function shareLogEntries(args : {clientSyncLog : ClientSyncLogStorage, sharedSyncLog : SharedSyncLog, userId, deviceId, now : number}) {
    const entries = await args.clientSyncLog.getUnsharedEntries()
    await args.sharedSyncLog.writeEntries(entries.map(entry => ({
        userId: null,
        deviceId: null,
        createdOn: entry.createdOn,
        sharedOn: args.now,
        data: JSON.stringify({
            operation: entry.operation,
            collection: entry.collection,
            pk: entry.pk,
            field: entry['field'] || null,
            value: entry['value'] || null,
        })
    })), {userId: args.userId, deviceId: args.deviceId})
    await args.clientSyncLog.updateSharedUntil({until: args.now, sharedOn: args.now})
}

export async function receiveLogEntries(args : {clientSyncLog : ClientSyncLogStorage, sharedSyncLog : SharedSyncLog, deviceId, now : number}) {
    const entries = await args.sharedSyncLog.getUnsyncedEntries({deviceId: args.deviceId})
    await args.clientSyncLog.insertReceivedEntries(entries, {now: args.now})
    await args.sharedSyncLog.updateSharedUntil({until: args.now, deviceId: args.deviceId})
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
    await receiveLogEntries({clientSyncLog, sharedSyncLog, deviceId, now})
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
