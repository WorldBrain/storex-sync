import { getObjectWithoutPk, getObjectPk } from '../utils'
import {ClientSyncLogDeletionEntry, ClientSyncLogEntry, ClientSyncLogModificationEntry} from '../client-sync-log/types'
import { StorageRegistry, OperationBatch } from '@worldbrain/storex';

export type ExecuteAndLog = (originalOperation : any, logEntries : ClientSyncLogEntry[]) => Promise<any>
export interface Next {process: (options : { operation : any[] }) => any}
export type GetNow = () => number | '$now' | '$now'
export interface OperationProcessorArgs {
    next : Next,
    operation : any[],
    executeAndLog : ExecuteAndLog,
    getNow : GetNow,
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

/**
 * Creates
 */
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
    {collection : string, value : any, getNow : GetNow, storageRegistry : StorageRegistry}
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

/**
 * Updates
 */
async function _processUpdateObject({next, operation, executeAndLog, getNow, includeCollections, storageRegistry} : OperationProcessorArgs) {
    const [collection, where, updates] = operation.slice(1)
    if (!includeCollections.has(collection)) {
        return next.process({operation})
    }

    const pk = getObjectPk(where, collection, storageRegistry)
    const logEntries : ClientSyncLogEntry[] = []
    for (const [fieldName, newValue] of Object.entries(updates)) {
        logEntries.push(_updateOperationToLogEntry({getNow, collection, pk, fieldName, newValue}))
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

    const logEntries: ClientSyncLogModificationEntry[] = await _updateOperationQueryToLogEntry({next,collection,where,updates,getNow,storageRegistry})

    await executeAndLog(
        {placeholder: 'update', operation: 'updateObjects', collection, where, updates},
        logEntries,
    )
}

async function _updateOperationQueryToLogEntry({next, collection, where, updates, getNow, storageRegistry}:
 { next: Next, collection: string, where: any, updates: any, getNow: GetNow, storageRegistry: StorageRegistry }): Promise<ClientSyncLogModificationEntry[]>
{
    const affectedObjects = await next.process({operation: ['findObjects', collection, where]})

    const logEntries: ClientSyncLogModificationEntry[] = []
    for (const object of affectedObjects) {
        const pk = getObjectPk(object, collection, storageRegistry)
        for (const [fieldName, newValue] of Object.entries(updates)) {
            logEntries.push(_updateOperationToLogEntry({getNow, collection, pk, fieldName, newValue}));
        }
    }

    return logEntries;
}

function _updateOperationToLogEntry({getNow,collection,pk, fieldName, newValue} : { getNow: GetNow, collection: string, pk: any, fieldName: any, newValue: any }) : ClientSyncLogModificationEntry {
    return {
        createdOn: getNow(),
        sharedOn: null,
        needsIntegration: false,
        collection,
        operation: "modify",
        pk: pk,
        field: fieldName,
        value: newValue
    } as ClientSyncLogModificationEntry;
}

/**
 * Deletes
 */
async function _processDeleteObject({next, operation, executeAndLog, getNow, includeCollections, storageRegistry} : OperationProcessorArgs) {

    const [collection, where] = operation.slice(1)
    if (!includeCollections.has(collection)) {
        return next.process({operation})
    }

    const pk = getObjectPk(where, collection, storageRegistry)

    const logEntries: ClientSyncLogEntry[] = [_deleteOperationToLogEntry(getNow,collection,pk)]

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

    const logEntries: ClientSyncLogEntry[] = await _deleteOperationQueryToLogEntry({next,getNow,collection,where})

    await executeAndLog(
        {placeholder: 'delete', operation: 'deleteObjects', collection, where},
        logEntries,
    )
}


async function _deleteOperationQueryToLogEntry({next, getNow, collection,where} : {next: any, getNow: GetNow, collection: string,where: any}) : Promise<ClientSyncLogDeletionEntry[]> {
    const affectedObjects = await next.process({operation: ['findObjects', collection, where]})

    return affectedObjects.map(
        (object:any) => _deleteOperationToLogEntry(getNow,collection,object.id)
    );
}

function _deleteOperationToLogEntry(getNow: any,collection:string,pk:any) : ClientSyncLogDeletionEntry {
    return {
        createdOn: getNow(),
        sharedOn: null,
        needsIntegration: false,
        collection,
        operation: "delete",
        pk: pk
    };
}


/**
 * Batch
 */
async function _processExecuteBatch({next, operation, executeAndLog, getNow, includeCollections, storageRegistry}: OperationProcessorArgs) {
    const batch: OperationBatch = operation[1]
    let logEntries: ClientSyncLogEntry[] = []
    for (const step of batch) {
        if (!includeCollections.has(step.collection)) {
            continue
        }

        if (step.operation === 'createObject') {
            logEntries.push(_logEntryForCreateObject({
                collection: step.collection,
                value: step.args,
                getNow,
                storageRegistry
            }))
        } else if (step.operation === 'updateObjects') {
            const logs = await _updateOperationQueryToLogEntry({next,collection: step.collection ,where: step.where, updates: step.updates, storageRegistry,getNow})
            logEntries = logEntries.concat(logs)
        } else if (step.operation === 'deleteObjects') {
            const logs = await _deleteOperationQueryToLogEntry({next,getNow, collection: step.collection, where: step.where});
            logEntries = logEntries.concat(logs)
        }
    }
    if (!logEntries) {
        return next.process({operation})
    }

    return executeAndLog(
        batch,
        logEntries,
    )
}
