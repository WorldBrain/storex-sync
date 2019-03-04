import { getObjectWithoutPk, getObjectPk } from '../utils'
import { ClientSyncLogEntry } from '../client-sync-log/types'
import { StorageRegistry } from '@worldbrain/storex';

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
}

async function _processCreateObject({operation, executeAndLog, getNow, storageRegistry} : OperationProcessorArgs) {
    const [collection, value] = operation.slice(1)
    const result = await executeAndLog(
        {placeholder: 'object', operation: 'createObject', collection, args: value},
        [{
            collection,
            createdOn: getNow(),
            needsIntegration: false,
            sharedOn: null,
            operation: 'create',
            pk: getObjectPk(value, collection, storageRegistry),
            value: getObjectWithoutPk(value, collection, storageRegistry)
        } as ClientSyncLogEntry]
    )
    const object = result.info.object.object
    return {object}
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
    
    await executeAndLog(
        {placeholder: 'update', operation: 'updateObjects', collection, where, updates},
        logEntries,
    )
}
