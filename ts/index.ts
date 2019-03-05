import StorageManager from "@worldbrain/storex"
import { ClientSyncLogStorage } from "./client-sync-log"
import { ClientSyncLogEntry } from "./client-sync-log/types"
import { SharedSyncLog } from "./shared-sync-log"
import { ExecutableOperation } from "./reconciliation"

export async function shareLogEntries(args : {clientSyncLog : ClientSyncLogStorage, sharedSyncLog : SharedSyncLog, userId, deviceId, now : number}) {
    const entries = await args.clientSyncLog.getUnsharedEntries()
    await args.sharedSyncLog.writeEntries(entries, {userId: args.userId, deviceId: args.deviceId})
    await args.clientSyncLog.updateSharedUntil({until: entries.slice(-1)[0], sharedOn: args.now})
}

export async function receiveLogEntries(args : {clientSyncLog : ClientSyncLogStorage, sharedSyncLog : SharedSyncLog, deviceId}) {
    const sharedUntil = Date.now()
    const entries = await args.sharedSyncLog.getUnsyncedEntries({deviceId: args.deviceId})
    await args.clientSyncLog.insertReceivedEntries(entries, {now: sharedUntil})
    await args.sharedSyncLog.updateSharedUntil({until: sharedUntil, deviceId: args.deviceId})
}

export async function writeReconcilation(args : {
    storageManager : StorageManager,
    reconciliation : ExecutableOperation[]
}) {
    await args.storageManager.operation('executeBatch', args.reconciliation)
}

export async function sync({clientSyncLog, sharedSyncLog, storageManager, reconciler, now, userId, deviceId} : {
    clientSyncLog : ClientSyncLogStorage,
    sharedSyncLog : SharedSyncLog,
    storageManager : StorageManager,
    reconciler : (logEntries : ClientSyncLogEntry[]) => Promise<ExecutableOperation[]> | ExecutableOperation[],
    now : number,
    userId,
    deviceId,
}) {
    await shareLogEntries({clientSyncLog, sharedSyncLog, userId, deviceId, now})
    await receiveLogEntries({clientSyncLog, sharedSyncLog, deviceId})

    while (true) {
        const entries = await clientSyncLog.getNextEntriesToIntgrate()
        if (!entries) {
            break
        }

        const reconciliation = await reconciler(entries)
        await writeReconcilation({storageManager, reconciliation})
        await clientSyncLog.markAsIntegrated(entries)
    }
}
