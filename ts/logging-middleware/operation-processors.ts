import { getObjectWithoutPk, getObjectPk } from '../utils'
import {ClientSyncLogDeletionEntry, ClientSyncLogEntry} from '../client-sync-log/types'
import { StorageRegistry, OperationBatch } from '@worldbrain/storex';

export type ExecuteAndLog = (originalOperation : any, logEntries : ClientSyncLogEntry[]) => Promise<any>
export interface OperationProcessorArgs {
    next : {process: (options : { operation : any[] }) => any},
    operation : any[],
    executeAndLog : ExecuteAndLog,
    getNow : () => number | '$now' | '$now',
    storageRegistry : StorageRegistry
    includeCollections : Set<string>
}
export type OperationProcessor = (args : OperationProcessorArgs) => Promise<any>
export type OperationProcessorMap = {[operation : string] : OperationProcessor}
export const DEFAULT_OPERATION_PROCESSORS : OperationProcessorMap = {
    createObject: _processCreateObject,
    updateObject: _processUpdateObject,
    updateObjects: _processUpdateObjects,
    deleteObject: _processDeleteObject,
    deleteObjects: _processDeleteObjects,
    executeBatch: _processExecuteBatch,
}

async function _processCreateObject({next, operation, executeAndLog, getNow, includeCollections, storageRegistry} : OperationProcessorArgs) {
    const [collection, value] = operation.slice(1)
    if (!includeCollections.has(collection)) {
        return next.process({operation})
    }
    
    const result = await executeAndLog(
        { placeholder: 'object' , operation: 'createObject', collection, args: value},
        [_logEntryForCreateObject({collection, value, getNow, storageRegistry}) as ClientSyncLogEntry]
    )
    const object = result.info.object.object
    return {object}
}

function _logEntryForCreateObject(
    {collection, value, getNow, storageRegistry} :
    {collection : string, value : any, getNow : () => number | '$now', storageRegistry : StorageRegistry}
) : ClientSyncLogEntry {
    return {
        collection,
        createdOn: getNow(),
        needsIntegration: false,
        sharedOn: null,
        operation: 'create',
        pk: getObjectPk(value, collection, storageRegistry),
        value: getObjectWithoutPk(value, collection, storageRegistry)
    }
}

async function _processUpdateObject({next, operation, executeAndLog, getNow, includeCollections, storageRegistry} : OperationProcessorArgs) {
    const [collection, where, updates] = operation.slice(1)
    if (!includeCollections.has(collection)) {
        return next.process({operation})
    }

    const pk = getObjectPk(where, collection, storageRegistry)
    const logEntries : ClientSyncLogEntry[] = []
    for (const [fieldName, newValue] of Object.entries(updates)) {
        logEntries.push({
            createdOn: getNow(),
            sharedOn: null,
            needsIntegration: false,
            field: fieldName,
            collection,
            operation: 'modify',
            pk: pk,
            value: newValue
        })
    }
    await executeAndLog(
        {placeholder: 'object', operation: 'updateObjects', collection, where, updates},
        logEntries,
    )
}

async function _processUpdateObjects({next, operation, executeAndLog, getNow, includeCollections, storageRegistry} : OperationProcessorArgs) {
    const [collection, where, updates] = operation.slice(1)
    if (!includeCollections.has(collection)) {
        return next.process({operation})
    }

    const logEntries : ClientSyncLogEntry[] = await _logEntriesForUpdateObjects({
        next, collection, where, updates, getNow, storageRegistry
    })
    
    await executeAndLog(
        {placeholder: 'update', operation: 'updateObjects', collection, where, updates},
        logEntries,
    )
}

async function _logEntriesForUpdateObjects(
    {next, collection, where, updates, getNow, storageRegistry} :
    {next : { process: (options : { operation : any }) => any }, collection : string, where : any, updates : any, getNow : () => number | '$now', storageRegistry : StorageRegistry}
) {
    const affected = await next.process({operation: ['findObjects', collection, where]})
    const logEntries : ClientSyncLogEntry[] = []
    for (const object of affected) {
        const pk = getObjectPk(object, collection, storageRegistry)
        for (const [fieldName, newValue] of Object.entries(updates)) {
            logEntries.push({
                createdOn: getNow(),
                sharedOn: null,
                needsIntegration: false,
                field: fieldName,
                collection,
                operation: 'modify',
                pk: pk,
                value: newValue
            })
        }
    }
    return logEntries
}


async function _processDeleteObject({next, operation, executeAndLog, getNow, includeCollections, storageRegistry} : OperationProcessorArgs) {

    const [collection, where] = operation.slice(1)
    if (!includeCollections.has(collection)) {
        return next.process({operation})
    }

    const pk = getObjectPk(where, collection, storageRegistry)
    const logEntries : ClientSyncLogEntry[] = []
        logEntries.push({
            createdOn: getNow(),
            sharedOn: null,
            needsIntegration: false,
            collection,
            operation: 'delete',
            pk: pk
        })

    await executeAndLog(
        {placeholder: 'delete', operation: 'deleteObjects', collection, where},
        logEntries,
    )
}

async function _processDeleteObjects({next, operation, executeAndLog, getNow, includeCollections, storageRegistry} : OperationProcessorArgs) {

    const [collection, where] = operation.slice(1)
    if (!includeCollections.has(collection)) {
        return next.process({operation})
    }

    const logEntries : ClientSyncLogEntry[] = await _logEntriesForDeleteObjects({
        next, collection, where, getNow, storageRegistry
    })

    await executeAndLog(
        {placeholder: 'delete', operation: 'deleteObjects', collection, where},
        logEntries,
    )
}

async function _logEntriesForDeleteObjects(
    {next, collection, where, getNow, storageRegistry} :
    {next : { process: (options : { operation : any }) => any }, collection : string, where : any, getNow : () => number | '$now', storageRegistry : StorageRegistry}
) {
    const affected = await next.process({operation: ['findObjects', collection, where]})
    const logEntries : ClientSyncLogEntry[] = []
    for (const object of affected) {
        const pk = getObjectPk(object, collection, storageRegistry)
            logEntries.push({
                createdOn: getNow(),
                sharedOn: null,
                needsIntegration: false,
                collection,
                operation: 'delete',
                pk: pk,
            })
    }
    return logEntries
}


async function _processExecuteBatch({next, operation, executeAndLog, getNow, includeCollections, storageRegistry} : OperationProcessorArgs) {
    const batch : OperationBatch = operation[1]
    const logEntries : ClientSyncLogEntry[] = []
    for (const step of batch) {
        if (!includeCollections.has(step.collection)) {
            continue
        }

        if (step.operation === 'createObject') {
            logEntries.push(_logEntryForCreateObject({collection: step.collection, value: step.args, getNow, storageRegistry}))
        }
        //todo: need other operations here?
    }
    if (!logEntries) {
        return next.process({ operation })
    }

    return executeAndLog(
        batch,
        logEntries,
    )
}
