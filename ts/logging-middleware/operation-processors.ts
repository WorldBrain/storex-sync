import { getObjectWithoutPk, getObjectPk } from '../utils'
import { ClientSyncLogEntry } from '../client-sync-log/types'
import { StorageRegistry, OperationBatch } from '@worldbrain/storex';

export type ExecuteAndLog = (originalOperation, logEntries : ClientSyncLogEntry[]) => Promise<any>
export interface OperationProcessorArgs {
    next : {process: ({operation}) => any},
    operation : any[],
    executeAndLog : ExecuteAndLog,
    getNow : () => number,
    storageRegistry : StorageRegistry
}
export type OperationProcessor = (args : OperationProcessorArgs) => Promise<any>
export type OperationProcessorMap = {[operation : string] : OperationProcessor}
export const DEFAULT_OPERATION_PROCESSORS : OperationProcessorMap = {
    createObject: _processCreateObject,
    updateObject: _processUpdateObject,
    updateObjects: _processUpdateObjects,
    executeBatch: _processExecuteBatch,
}

async function _processCreateObject({operation, executeAndLog, getNow, storageRegistry} : OperationProcessorArgs) {
    const [collection, value] = operation.slice(1)
    const result = await executeAndLog(
        {placeholder: 'object', operation: 'createObject', collection, args: value},
        [_logEntryForCreateObject({collection, value, getNow, storageRegistry}) as ClientSyncLogEntry]
    )
    const object = result.info.object.object
    return {object}
}

function _logEntryForCreateObject(
    {collection, value, getNow, storageRegistry} :
    {collection : string, value, getNow : () => number, storageRegistry : StorageRegistry}
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

async function _processUpdateObject({operation, executeAndLog, getNow, storageRegistry} : OperationProcessorArgs) {
    const [collection, where, updates] = operation.slice(1)
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

async function _processUpdateObjects({next, operation, executeAndLog, getNow, storageRegistry} : OperationProcessorArgs) {
    const [collection, where, updates] = operation.slice(1)
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
    {next : {process: ({operation}) => any}, collection : string, where, updates, getNow : () => number, storageRegistry : StorageRegistry}
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

async function _processExecuteBatch({next, operation, executeAndLog, getNow, storageRegistry} : OperationProcessorArgs) {
    const batch : OperationBatch = operation[1]
    const logEntries : ClientSyncLogEntry[] = []
    for (const step of batch) {
        if (step.operation === 'createObject') {
            logEntries.push(_logEntryForCreateObject({collection: step.collection, value: step.args, getNow, storageRegistry}))
        }
    }

    await executeAndLog(
        batch,
        logEntries,
    )
}
