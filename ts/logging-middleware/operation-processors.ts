import { getObjectWithoutPk, getObjectPk } from '../utils'
import {
    ClientSyncLogDeletionEntry,
    ClientSyncLogEntry,
    ClientSyncLogModificationEntry,
} from '../client-sync-log/types'
import { StorageRegistry, OperationBatch } from '@worldbrain/storex'

export type ExecuteAndLog = (
    originalOperation: any,
    logEntries: ClientSyncLogEntry[],
) => Promise<any>
export interface Next {
    process: (options: { operation: any[] }) => any
}
export type GetNow = () => Promise<number | '$now'>
export interface OperationProcessorArgs {
    next: Next
    deviceId: string | number
    operation: any[]
    executeAndLog: ExecuteAndLog
    getNow: GetNow
    storageRegistry: StorageRegistry
    includeCollections: Set<string>
}
export type OperationProcessor = (args: OperationProcessorArgs) => Promise<any>
export type OperationProcessorMap = { [operation: string]: OperationProcessor }
export const DEFAULT_OPERATION_PROCESSORS: OperationProcessorMap = {
    createObject: _processCreateObject,
    updateObject: _processUpdateObject,
    updateObjects: _processUpdateObjects,
    deleteObject: _processDeleteObject,
    deleteObjects: _processDeleteObjects,
    executeBatch: _processExecuteBatch,
}

/**
 * Creates
 */
async function _processCreateObject(args: OperationProcessorArgs) {
    const { operation } = args

    const [collection, value] = operation.slice(1)
    if (!args.includeCollections.has(collection)) {
        return args.next.process({ operation })
    }

    const result = await args.executeAndLog(
        {
            placeholder: 'object',
            operation: 'createObject',
            collection,
            args: value,
        },
        [
            (await _logEntryForCreateObject({
                ...args,
                collection,
                value,
            })) as ClientSyncLogEntry,
        ],
    )
    const object = result.info.object.object
    return { object }
}

async function _logEntryForCreateObject(args: {
    collection: string
    deviceId: number | string
    value: any
    getNow: GetNow
    storageRegistry: StorageRegistry
}): Promise<ClientSyncLogEntry> {
    const { value, collection, storageRegistry } = args

    return {
        collection: args.collection,
        createdOn: await args.getNow(),
        deviceId: args.deviceId,
        needsIntegration: false,
        sharedOn: null,
        operation: 'create',
        pk: getObjectPk(value, collection, storageRegistry),
        value: getObjectWithoutPk(value, collection, storageRegistry),
    }
}

/**
 * Updates
 */
async function _processUpdateObject(args: OperationProcessorArgs) {
    const { operation } = args

    const [collection, where, updates] = operation.slice(1)
    if (!args.includeCollections.has(collection)) {
        return args.next.process({ operation })
    }

    const pk = getObjectPk(where, collection, args.storageRegistry)
    const logEntries: ClientSyncLogEntry[] = []
    for (const [fieldName, newValue] of Object.entries(updates)) {
        logEntries.push(
            await _updateOperationToLogEntry({
                ...args,
                collection,
                pk,
                fieldName,
                newValue,
            }),
        )
    }
    await args.executeAndLog(
        {
            placeholder: 'object',
            operation: 'updateObjects',
            collection,
            where,
            updates,
        },
        logEntries,
    )
}

async function _processUpdateObjects(args: OperationProcessorArgs) {
    const { operation } = args

    const [collection, where, updates] = operation.slice(1)
    if (!args.includeCollections.has(collection)) {
        return args.next.process({ operation })
    }

    const logEntries: ClientSyncLogModificationEntry[] = await _updateOperationQueryToLogEntry(
        { collection, where, updates, ...args },
    )

    await args.executeAndLog(
        {
            placeholder: 'update',
            operation: 'updateObjects',
            collection,
            where,
            updates,
        },
        logEntries,
    )
}

async function _updateOperationQueryToLogEntry(args: {
    next: Next
    collection: string
    deviceId: string | number
    where: any
    updates: any
    getNow: GetNow
    storageRegistry: StorageRegistry
}): Promise<ClientSyncLogModificationEntry[]> {
    const { next, collection } = args

    const affectedObjects = await next.process({
        operation: ['findObjects', collection, args.where],
    })

    const logEntries: ClientSyncLogModificationEntry[] = []
    for (const object of affectedObjects) {
        const pk = getObjectPk(object, collection, args.storageRegistry)
        for (const [fieldName, newValue] of Object.entries(args.updates)) {
            logEntries.push(
                await _updateOperationToLogEntry({
                    ...args,
                    pk,
                    fieldName,
                    newValue,
                }),
            )
        }
    }

    return logEntries
}

async function _updateOperationToLogEntry(args: {
    getNow: GetNow
    deviceId: number | string
    collection: string
    pk: any
    fieldName: any
    newValue: any
}): Promise<ClientSyncLogModificationEntry> {
    return {
        createdOn: await args.getNow(),
        sharedOn: null,
        deviceId: args.deviceId,
        needsIntegration: false,
        collection: args.collection,
        operation: 'modify',
        pk: args.pk,
        field: args.fieldName,
        value: args.newValue,
    } as ClientSyncLogModificationEntry
}

/**
 * Deletes
 */
async function _processDeleteObject({
    next,
    deviceId,
    operation,
    executeAndLog,
    getNow,
    includeCollections,
    storageRegistry,
}: OperationProcessorArgs) {
    const [collection, where] = operation.slice(1)
    if (!includeCollections.has(collection)) {
        return next.process({ operation })
    }

    const pk = getObjectPk(where, collection, storageRegistry)

    const logEntries: ClientSyncLogEntry[] = [
        await _deleteOperationToLogEntry({ getNow, deviceId, collection, pk }),
    ]

    await executeAndLog(
        {
            placeholder: 'delete',
            operation: 'deleteObjects',
            collection,
            where,
        },
        logEntries,
    )
}

async function _processDeleteObjects({
    next,
    deviceId,
    operation,
    executeAndLog,
    getNow,
    includeCollections,
    storageRegistry,
}: OperationProcessorArgs) {
    const [collection, where] = operation.slice(1)
    if (!includeCollections.has(collection)) {
        return next.process({ operation })
    }

    const logEntries: ClientSyncLogEntry[] = await _deleteOperationQueryToLogEntry(
        { next, deviceId, getNow, collection, where, storageRegistry },
    )

    await executeAndLog(
        {
            placeholder: 'delete',
            operation: 'deleteObjects',
            collection,
            where,
        },
        logEntries,
    )
}

async function _deleteOperationQueryToLogEntry(args: {
    next: Next
    deviceId: string | number
    getNow: GetNow
    collection: string
    where: any
    storageRegistry: StorageRegistry
}): Promise<ClientSyncLogDeletionEntry[]> {
    const { collection } = args

    const affectedObjects = await args.next.process({
        operation: ['findObjects', collection, args.where],
    })

    return Promise.all(affectedObjects.map((object: any) =>
        _deleteOperationToLogEntry({
            ...args,
            collection,
            pk: getObjectPk(object, collection, args.storageRegistry),
        }),
    ))
}

async function _deleteOperationToLogEntry(args: {
    getNow: GetNow
    collection: string
    pk: any
    deviceId: string | number
}): Promise<ClientSyncLogDeletionEntry> {
    return {
        createdOn: await args.getNow(),
        sharedOn: null,
        deviceId: args.deviceId,
        needsIntegration: false,
        collection: args.collection,
        operation: 'delete',
        pk: args.pk,
    }
}

/**
 * Batch
 */
async function _processExecuteBatch({
    next,
    deviceId,
    operation,
    executeAndLog,
    getNow,
    includeCollections,
    storageRegistry,
}: OperationProcessorArgs) {
    const batch: OperationBatch = operation[1]
    let logEntries: ClientSyncLogEntry[] = []
    for (const step of batch) {
        if (!includeCollections.has(step.collection)) {
            continue
        }

        if (step.operation === 'createObject') {
            logEntries.push(
                await _logEntryForCreateObject({
                    collection: step.collection,
                    deviceId,
                    value: step.args,
                    getNow,
                    storageRegistry,
                }),
            )
        } else if (step.operation === 'updateObjects') {
            const logs = await _updateOperationQueryToLogEntry({
                next,
                deviceId,
                collection: step.collection,
                where: step.where,
                updates: step.updates,
                storageRegistry,
                getNow,
            })
            logEntries = logEntries.concat(logs)
        } else if (step.operation === 'deleteObjects') {
            const logs = await _deleteOperationQueryToLogEntry({
                next,
                deviceId,
                getNow,
                collection: step.collection,
                where: step.where,
                storageRegistry,
            })
            logEntries = logEntries.concat(logs)
        }
    }
    if (!logEntries) {
        return next.process({ operation })
    }

    return executeAndLog(batch, logEntries)
}
