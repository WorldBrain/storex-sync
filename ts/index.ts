import { Omit } from 'lodash'
import TypedEmitter from 'typed-emitter'
import { jsonDateParser } from 'json-date-parser'
import last from 'lodash/last'
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
    sendingSharedEntries: (event: {
        entries: Omit<SharedSyncLogEntry, 'userId' | 'deviceId' | 'sharedOn'>[]
        deviceId: number | string
    }) => void
    receivedSharedEntries: (event: {
        entries: SharedSyncLogEntry[]
        deviceId: number | string
    }) => void
    reconcilingEntries: (event: {
        entries: ClientSyncLogEntry[]
        deviceId: number | string
    }) => void
    reconciledEntries: (event: {
        entries: ClientSyncLogEntry[]
        deviceId: number | string
        reconciliation: any[]
    }) => void
}
export const SYNC_EVENTS: { [Key in keyof SyncEventMap]: {} } = {
    sendingSharedEntries: {},
    receivedSharedEntries: {},
    reconcilingEntries: {},
    reconciledEntries: {},
}

export type SyncPreSendProcessor = (params: {
    entry: ClientSyncLogEntry
}) => Promise<{ entry: ClientSyncLogEntry | null }>
export type SyncPostReceiveProcessor = (params: {
    entry: SharedSyncLogEntry<'deserialized-data'>
}) => Promise<{ entry: SharedSyncLogEntry<'deserialized-data'> | null }>

export interface CommonSyncOptions {
    clientSyncLog: ClientSyncLogStorage
    sharedSyncLog: SharedSyncLog
    now: number | '$now'
    userId: number | string
    deviceId: number | string
    serializer?: SyncSerializer
    preSend?: SyncPreSendProcessor
    postReceive?: SyncPostReceiveProcessor
    syncEvents?: SyncEvents
    batchSize?: number
    singleBatch?: boolean
}
export interface SyncOptions extends CommonSyncOptions {
    storageManager: StorageManager
    reconciler: ReconcilerFunction
    extraSentInfo?: any
}

export async function shareLogEntries(
    args: CommonSyncOptions & { extraSentInfo?: any },
): Promise<{ finished: boolean }> {
    const preSend: SyncPreSendProcessor = args.preSend || (async args => args)
    const serializeEntryData = args.serializer
        ? args.serializer.serializeSharedSyncLogEntryData
        : async (data: SharedSyncLogEntryData) => JSON.stringify(data)

    while (true) {
        const entries = await args.clientSyncLog.getUnsharedEntries({
            batchSize: args.batchSize,
        })
        if (!entries.length) {
            return { finished: true }
        }

        const processedEntries = (
            await Promise.all(
                entries.map(async entry => (await preSend({ entry })).entry),
            )
        ).filter(entry => !!entry) as ClientSyncLogEntry[]

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
        await args.sharedSyncLog.writeEntries(sharedLogEntries, args)
        await args.clientSyncLog.updateSharedUntil({
            until: last(entries)!.createdOn,
            sharedOn: args.now,
        })

        if (args.singleBatch) {
            return { finished: false }
        }
    }
}

export async function receiveLogEntries(
    args: CommonSyncOptions,
): Promise<{ finished: boolean }> {
    const postReceive: SyncPostReceiveProcessor =
        args.postReceive || (async args => args)
    const deserializeEntryData = args.serializer
        ? args.serializer.deserializeSharedSyncLogEntryData
        : async (serialized: string) => JSON.parse(serialized, jsonDateParser)
    const serializeEntryData = args.serializer
        ? args.serializer.serializeSharedSyncLogEntryData
        : async (deserialized: SharedSyncLogEntryData) =>
            JSON.stringify(deserialized)

    while (true) {
        const logUpdate = await args.sharedSyncLog.getUnsyncedEntries({
            userId: args.userId,
            deviceId: args.deviceId,
            batchSize: args.batchSize,
        })
        if (!logUpdate.entries.length) {
            return { finished: true }
        }

        const processedEntries = (
            await Promise.all(
                logUpdate.entries.map(async entry => {
                    const deserializedEntry: SharedSyncLogEntry<'deserialized-data'> = {
                        ...entry,
                        data: await deserializeEntryData(entry.data),
                    }

                    const postProcessed = await postReceive({
                        entry: deserializedEntry,
                    })
                    return postProcessed.entry
                }),
            )
        ).filter(entry => !!entry) as SharedSyncLogEntry<'deserialized-data'>[]

        if (args.syncEvents) {
            args.syncEvents.emit('receivedSharedEntries', {
                entries: await Promise.all(
                    processedEntries.map(async entry => ({
                        ...entry,
                        data: await serializeEntryData(entry.data),
                    })),
                ),
                deviceId: args.deviceId,
            })
        }
        await args.clientSyncLog.insertReceivedEntries(processedEntries, {
            now: args.now,
        })
        await args.sharedSyncLog.markAsSeen(logUpdate, {
            userId: args.userId,
            deviceId: args.deviceId,
        })

        if (args.singleBatch) {
            return { finished: false }
        }
    }
}

export async function writeReconcilation(args: {
    storageManager: StorageManager
    clientSyncLog: ClientSyncLogStorage
    entries: ClientSyncLogEntry[]
    reconciliation: OperationBatch
}) {
    const batchSteps = [
        ...args.reconciliation,
        ...args.clientSyncLog.getMarkAsIntegratedBatchSteps(args.entries),
    ]
    await args.storageManager.backend.operation(
        'executeBatch',
        batchSteps.map((step: any) => ({
            ...step,
            placeholder: '',
        })),
    )
}

export async function reconcileStorage(options: {
    storageManager: StorageManager
    reconciler: ReconcilerFunction
    clientSyncLog: ClientSyncLogStorage
    deviceId: number | string
    syncEvents?: SyncEvents
    singleStep?: boolean
}): Promise<{ finished: boolean }> {
    while (true) {
        const entries = await options.clientSyncLog.getNextEntriesToIntgrate()
        if (!entries) {
            return { finished: true }
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
            clientSyncLog: options.clientSyncLog,
            entries,
            reconciliation,
        })

        if (options.singleStep) {
            return { finished: false }
        }
    }
}

export async function doSync(
    options: SyncOptions,
): Promise<{ finished: boolean }> {
    const { finished: receiveFinished } = await receiveLogEntries(options)
    if (!receiveFinished) {
        return { finished: false }
    }

    const { finished: shareFinished } = await shareLogEntries(options)
    if (!shareFinished) {
        return { finished: false }
    }

    await reconcileStorage(options)

    return { finished: true }
}
