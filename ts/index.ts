import pick from 'lodash/pick'
import StorageManager from "@worldbrain/storex"
import { ClientSyncLogStorage } from "./client-sync-log"
import { SharedSyncLog } from "./shared-sync-log"
import { ReconcilerFunction, ExecutableOperation } from "./reconciliation"
import { SharedSyncLogEntryData } from './shared-sync-log/types';

export interface SyncSerializer {
    serializeSharedSyncLogEntryData : (data : SharedSyncLogEntryData) => Promise<string>
    deserializeSharedSyncLogEntryData : (serialized : string) => Promise<SharedSyncLogEntryData>
}

export async function shareLogEntries(args : {
    clientSyncLog : ClientSyncLogStorage, sharedSyncLog : SharedSyncLog,
    userId : number | string, deviceId : number | string, now : number | '$now',
    serializer? : SyncSerializer,
}) {
    const serializeEntryData = args.serializer
        ? args.serializer.serializeSharedSyncLogEntryData
        : (async (data: SharedSyncLogEntryData) => JSON.stringify(data))
    
    const entries = await args.clientSyncLog.getUnsharedEntries()
    const sharedLogEntries = await Promise.all(entries.map(async entry => ({
        createdOn: entry.createdOn,
        data: await serializeEntryData({
            operation: entry.operation,
            collection: entry.collection,
            pk: entry.pk,
            field: entry['field'] || null,
            value: entry['value'] || null,
        })
    })))
    await args.sharedSyncLog.writeEntries(sharedLogEntries, pick(args, ['userId', 'deviceId', 'now']))
    await args.clientSyncLog.updateSharedUntil({ until: args.now, sharedOn: args.now })
}

export async function receiveLogEntries(args : {
    clientSyncLog : ClientSyncLogStorage, sharedSyncLog : SharedSyncLog,
    userId : number | string,
    deviceId : number | string,
    now : number | '$now',
    serializer? : SyncSerializer,
}) {
    const deserializeEntryData = args.serializer
        ? args.serializer.deserializeSharedSyncLogEntryData
        : (async (serialized: string) => JSON.parse(serialized))

    const entries = await args.sharedSyncLog.getUnsyncedEntries({ userId: args.userId, deviceId: args.deviceId })
    await args.clientSyncLog.insertReceivedEntries(await Promise.all(entries.map(async entry => {
        return { ...entry, data: await deserializeEntryData(entry.data) }
    })), {now: args.now})
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

export async function doSync(options : {
    clientSyncLog : ClientSyncLogStorage,
    sharedSyncLog : SharedSyncLog,
    storageManager : StorageManager,
    reconciler : ReconcilerFunction,
    now : number | '$now',
    userId : number | string,
    deviceId : number | string,
    serializer? : SyncSerializer,
}) {
    await receiveLogEntries(options)
    await shareLogEntries(options)
    
    while (true) {
        const entries = await options.clientSyncLog.getNextEntriesToIntgrate()
        if (!entries) {
            break
        }

        const reconciliation = await options.reconciler(entries, {storageRegistry: options.storageManager.registry})
        await writeReconcilation({ storageManager: options.storageManager, reconciliation })
        await options.clientSyncLog.markAsIntegrated(entries)
    }
}
