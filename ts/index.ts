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
        entries: SharedSyncLogEntry<'deserialized-data'>[]
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
export type ExecuteReconciliationOperation = (
    operationName: string,
    ...args: any[]
) => Promise<any>

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
    uploadBatchSize?: number
    uploadBatchByteLimit?: number
    downloadBatchSize?: number
    singleBatch?: boolean
    continueSync?: (info: { stage: SyncStage }) => boolean
}
export type SyncStage = 'receive' | 'share' | 'integrate'
export interface SyncOptions extends CommonSyncOptions {
    storageManager: StorageManager
    reconciler: ReconcilerFunction
    extraSentInfo?: any
    stages?: { receive?: boolean; share?: boolean; reconcile?: boolean }
    reconciliationProcessor?: (
        reconciliation: OperationBatch,
    ) => Promise<OperationBatch>
    executeReconciliationOperation?: ExecuteReconciliationOperation
    cleanupAfterReconcile?: boolean
}
export interface SyncReturnValue {
    finished: boolean
}

export async function shareLogEntries(
    args: CommonSyncOptions & { extraSentInfo?: any },
): Promise<{ finished: boolean }> {
    const preSend: SyncPreSendProcessor = args.preSend || (async args => args)
    const serializeEntryData = args.serializer
        ? args.serializer.serializeSharedSyncLogEntryData
        : async (data: SharedSyncLogEntryData) => JSON.stringify(data)

    let temporaryBatchSize: number | null = null
    while (true) {
        const batchSize = temporaryBatchSize || args.uploadBatchSize
        temporaryBatchSize = null

        const entries = await args.clientSyncLog.getUnsharedEntries({
            batchSize,
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

        if (args.uploadBatchByteLimit) {
            const estimatedBatchSizeBytes = sharedLogEntries.reduce(
                (acc, entry) => acc + entry.data.length + 100,
                0,
            )
            const limitExceeded =
                estimatedBatchSizeBytes > args.uploadBatchByteLimit
            if (limitExceeded) {
                if (batchSize) {
                    if (batchSize < 2) {
                        throw new Error(
                            `Sync batch size exceeds limit during upload, but cannot make it smaller`,
                        )
                    }

                    temporaryBatchSize = Math.floor(batchSize / 2)
                } else {
                    temporaryBatchSize = 16
                }
                continue
            }
        }

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
            batchSize: args.downloadBatchSize,
        })
        if (!logUpdate.entries.length) {
            await args.sharedSyncLog.markAsSeen(logUpdate, {
                userId: args.userId,
                deviceId: args.deviceId,
                now: args.now,
            })
            return { finished: true }
        }

        const processedEntries = (
            await Promise.all(
                logUpdate.entries.map(async entry => {
                    const deserializedEntry: SharedSyncLogEntry<'deserialized-data'> = {
                        ...entry,
                        data: await deserializeEntryData(entry.data),
                    }
                    if (!deserializedEntry.data) {
                        return null
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
                entries: processedEntries,
                deviceId: args.deviceId,
            })
        }
        await args.clientSyncLog.insertReceivedEntries(processedEntries, {
            now: args.now,
        })
        await args.sharedSyncLog.markAsSeen(logUpdate, {
            userId: args.userId,
            deviceId: args.deviceId,
            now: args.now,
        })

        if (!continueSync('receive', args)) {
            return { finished: false }
        }
    }
}

export async function writeReconcilation(args: {
    storageManager: StorageManager
    clientSyncLog: ClientSyncLogStorage
    entries: ClientSyncLogEntry[]
    reconciliation: OperationBatch
    executeReconciliationOperation?: ExecuteReconciliationOperation
}) {
    const executeReconciliationOperation =
        args.executeReconciliationOperation ??
        ((name, ...operation) =>
            args.storageManager.backend.operation(name, ...operation))

    const batchSteps = [
        ...args.reconciliation,
        ...args.clientSyncLog.getMarkAsIntegratedBatchSteps(args.entries),
    ]
    for (const [stepIndex, step] of Object.entries(batchSteps)) {
        step.placeholder = `step-${stepIndex}`
    }
    await executeReconciliationOperation('executeBatch', batchSteps)
}

export async function reconcileStorage(
    options: SyncOptions,
): Promise<{ finished: boolean }> {
    while (true) {
        const entries = await options.clientSyncLog.getNextEntriesToIntgrate()
        if (!entries) {
            return { finished: true }
        }

        let reconciliation = await options.reconciler(entries, {
            storageRegistry: options.storageManager.registry,
        })
        if (options.reconciliationProcessor) {
            reconciliation = await options.reconciliationProcessor(
                reconciliation,
            )
        }

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
            executeReconciliationOperation:
                options.executeReconciliationOperation,
        })

        if (!continueSync('integrate', options)) {
            return { finished: false }
        }
    }
}

export async function doSync(options: SyncOptions): Promise<SyncReturnValue> {
    if (options.stages?.receive ?? true) {
        const { finished: receiveFinished } = await receiveLogEntries(options)
        if (!receiveFinished || !continueSync('share', options)) {
            return { finished: false }
        }
    }

    if (options.stages?.share ?? true) {
        const { finished: shareFinished } = await shareLogEntries(options)
        if (!shareFinished || !continueSync('integrate', options)) {
            return { finished: false }
        }
    }

    if (options.stages?.reconcile ?? true) {
        const { finished: reconciliationFinished } = await reconcileStorage(
            options,
        )
        if (!reconciliationFinished) {
            return { finished: false }
        }
    }

    if (options.cleanupAfterReconcile) {
        await options.clientSyncLog.deleteObsoleteEntries()
    }

    return { finished: true }
}

function continueSync(
    stage: SyncStage,
    options: Pick<SyncOptions, 'continueSync' | 'singleBatch'>,
): boolean {
    return options.continueSync
        ? options.continueSync({ stage })
        : !options.singleBatch
}
