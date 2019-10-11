import { Omit } from 'lodash'
import TypedEmitter from 'typed-emitter'
import { jsonDateParser } from 'json-date-parser'
import pick from 'lodash/pick'
import StorageManager, { OperationBatch } from '@worldbrain/storex'
import { ClientSyncLogStorage } from './client-sync-log'
import { SharedSyncLog } from './shared-sync-log'
import { ReconcilerFunction } from './reconciliation'
import {
    SharedSyncLogEntryData,
    SharedSyncLogEntry,
} from './shared-sync-log/types'
import { ClientSyncLogEntry } from './client-sync-log/types'

export interface SyncSerializer {
    serializeSharedSyncLogEntryData: (
        data: SharedSyncLogEntryData,
    ) => Promise<string>
    deserializeSharedSyncLogEntryData: (
        serialized: string,
    ) => Promise<SharedSyncLogEntryData>
}

export type SyncEvents = TypedEmitter<SyncEventMap>
export interface SyncEventMap {
    unsharedClientEntries: (event: {
        entries: ClientSyncLogEntry[], deviceId: number | string
    }) => void
    sendingSharedEntries: (event: {
        entries: Omit<SharedSyncLogEntry, 'userId' | 'deviceId' | 'sharedOn'>[],
        deviceId: number | string
    }) => void
    receivedSharedEntries: (event: {
        entries: SharedSyncLogEntry[], deviceId: number | string
    }) => void
    reconcilingEntries: (event: {
        entries: ClientSyncLogEntry[], deviceId: number | string
    }) => void
    reconciledEntries: (event: {
        entries: ClientSyncLogEntry[], deviceId: number | string
        reconciliation: any[]
    }) => void
}
export const SYNC_EVENTS: { [Key in keyof SyncEventMap]: {} } = {
    unsharedClientEntries: {},
    sendingSharedEntries: {},
    receivedSharedEntries: {},
    reconcilingEntries: {},
    reconciledEntries: {},
}

export type SyncPreSendProcessor = (params: {
    entry: ClientSyncLogEntry
}) => Promise<{ entry: ClientSyncLogEntry | null }>
export type SyncPostReceiveProcessor = (params: {
    entry: ClientSyncLogEntry
}) => Promise<{ entry: ClientSyncLogEntry | null }>

export async function shareLogEntries(args: {
    clientSyncLog: ClientSyncLogStorage
    sharedSyncLog: SharedSyncLog
    userId: number | string
    deviceId: number | string
    now: number | '$now'
    serializer?: SyncSerializer
    preSend?: SyncPreSendProcessor
    syncEvents?: SyncEvents
}) {
    const preSend: SyncPreSendProcessor = args.preSend || (async args => args)
    const serializeEntryData = args.serializer
        ? args.serializer.serializeSharedSyncLogEntryData
        : async (data: SharedSyncLogEntryData) => JSON.stringify(data)

    const entries = await args.clientSyncLog.getUnsharedEntries()
    if (args.syncEvents) {
        args.syncEvents.emit('unsharedClientEntries', { entries, deviceId: args.deviceId })
    }

    const processedEntries = (await Promise.all(
        entries.map(async entry => (await preSend({ entry })).entry),
    )).filter(entry => !!entry) as ClientSyncLogEntry[]

    const sharedLogEntries = await Promise.all(
        processedEntries.map(async entry => ({
            createdOn: entry.createdOn,
            data: await serializeEntryData({
                operation: entry.operation,
                collection: entry.collection,
                pk: entry.pk,
                field: entry['field'] || null,
                value: entry['value'] || null,
            }),
        })),
    )
    if (args.syncEvents) {
        args.syncEvents.emit('sendingSharedEntries', {
            entries: sharedLogEntries,
            deviceId: args.deviceId,
        })
    }
    await args.sharedSyncLog.writeEntries(
        sharedLogEntries,
        pick(args, ['userId', 'deviceId', 'now']),
    )
    await args.clientSyncLog.updateSharedUntil({
        until: args.now,
        sharedOn: args.now,
    })
}

export async function receiveLogEntries(args: {
    clientSyncLog: ClientSyncLogStorage
    sharedSyncLog: SharedSyncLog
    userId: number | string
    deviceId: number | string
    now: number | '$now'
    serializer?: SyncSerializer
    syncEvents?: SyncEvents
}) {
    const deserializeEntryData = args.serializer
        ? args.serializer.deserializeSharedSyncLogEntryData
        : async (serialized: string) => JSON.parse(serialized, jsonDateParser)

    const logUpdate = await args.sharedSyncLog.getUnsyncedEntries({
        userId: args.userId,
        deviceId: args.deviceId,
    })
    if (args.syncEvents) {
        args.syncEvents.emit('receivedSharedEntries', {
            entries: logUpdate.entries,
            deviceId: args.deviceId,
        })
    }
    await args.clientSyncLog.insertReceivedEntries(
        await Promise.all(
            logUpdate.entries.map(async entry => {
                return {
                    ...entry,
                    data: await deserializeEntryData(entry.data),
                }
            }),
        ),
        { now: args.now },
    )
    await args.sharedSyncLog.markAsSeen(logUpdate, {
        userId: args.userId,
        deviceId: args.deviceId,
    })
}

export async function writeReconcilation(args: {
    storageManager: StorageManager
    reconciliation: OperationBatch
}) {
    await args.storageManager.backend.operation(
        'executeBatch',
        args.reconciliation.map((step: any) => ({
            ...step,
            placeholder: '',
        })),
    )
}

export async function doSync(options: {
    clientSyncLog: ClientSyncLogStorage
    sharedSyncLog: SharedSyncLog
    storageManager: StorageManager
    reconciler: ReconcilerFunction
    now: number | '$now'
    userId: number | string
    deviceId: number | string
    serializer?: SyncSerializer
    preSend?: SyncPreSendProcessor
    postReceive?: SyncPostReceiveProcessor
    syncEvents?: SyncEvents
}) {
    await receiveLogEntries(options)
    await shareLogEntries(options)

    while (true) {
        const entries = await options.clientSyncLog.getNextEntriesToIntgrate()
        if (!entries) {
            break
        }

        if (options.syncEvents) {
            options.syncEvents.emit('reconcilingEntries', {
                entries,
                deviceId: options.deviceId,
            })
        }

        const reconciliation = await options.reconciler(entries, {
            storageRegistry: options.storageManager.registry,
        })

        if (options.syncEvents) {
            options.syncEvents.emit('reconciledEntries', {
                entries,
                reconciliation,
                deviceId: options.deviceId,
            })
        }

        await writeReconcilation({
            storageManager: options.storageManager,
            reconciliation,
        })
        await options.clientSyncLog.markAsIntegrated(entries)
    }
}
