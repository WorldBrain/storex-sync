import { StorageMiddleware } from '@worldbrain/storex/lib/types/middleware'
import { ClientSyncLogStorage } from "../client-sync-log";
import StorageManager, { OperationBatch } from '@worldbrain/storex';
import { getObjectWithoutPk, getObjectPk } from '../utils';
import { ClientSyncLogEntry } from '../client-sync-log/types';

export type ExecuteAndLog = (originalOperation, logEntries : ClientSyncLogEntry[]) => Promise<any>
export type OperationProcessorArgs = {next : {process: ({operation}) => any}, operation : any[], executeAndLog : ExecuteAndLog}

export class SyncLoggingMiddleware implements StorageMiddleware {
    private _clientSyncLog : ClientSyncLogStorage
    private _storageManager : StorageManager

    constructor({clientSyncLog, storageManager} : {clientSyncLog : ClientSyncLogStorage, storageManager : StorageManager}) {
        this._clientSyncLog = clientSyncLog
        this._storageManager = storageManager
    }
    
    async process({next, operation} : {next : {process: ({operation}) => any}, operation : any[]}) {
        const executeAndLog = (originalOperation, logEntries : ClientSyncLogEntry[]) => {
            const batch = [originalOperation]
            for (const logEntry of logEntries) {
                batch.push({
                    placeholder: 'logEntry',
                    operation: 'createObject',
                    collection: 'clientSyncLog',
                    args: logEntry
                })
            }
            return next.process({operation: [
                'executeBatch',
                batch
            ]})
        }

        const operationType = (operation[0] as string)
        if (operationType === 'createObject') {
            return this._processCreateObject({next, operation, executeAndLog})
        } else if (operationType === 'updateObject') {
            return this._processUpdateObject({next, operation, executeAndLog})
        } else if (operationType === 'updateObjects') {
            return this._processUpdateObjects({next, operation, executeAndLog})
        }

        return next.process({operation})
    }

    async _processCreateObject({operation, executeAndLog} : OperationProcessorArgs) {
        const [collection, value] = operation.slice(1)
        const result = await executeAndLog(
            {placeholder: 'object', operation: 'createObject', collection, args: value},
            [{
                collection,
                createdOn: this._getNow(),
                syncedOn: null,
                operation: 'create',
                pk: getObjectPk(value, collection, this._storageManager.registry),
                value: getObjectWithoutPk(value, collection, this._storageManager.registry)
            } as ClientSyncLogEntry]
        )
        const object = result.info.object.object
        return {object}
    }

    _getNow() {
        return Date.now()
    }

    async _processUpdateObject({next, operation, executeAndLog} : OperationProcessorArgs) {
        const [collection, where, updates] = operation.slice(1)
        const pk = getObjectPk(where, collection, this._storageManager.registry);
        const logEntries : ClientSyncLogEntry[] = []
        for (const [fieldName, newValue] of Object.entries(updates)) {
            logEntries.push({
                createdOn: this._getNow(),
                syncedOn: null,
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

    async _processUpdateObjects({next, operation, executeAndLog} : OperationProcessorArgs) {
        const [collection, where, updates] = operation.slice(1)
        const affected = await next.process({operation: ['findObjects', collection, where]})
        const logEntries : ClientSyncLogEntry[] = []
        for (const object of affected) {
            const pk = getObjectPk(object, collection, this._storageManager.registry)
            for (const [fieldName, newValue] of Object.entries(updates)) {
                logEntries.push({
                    createdOn: this._getNow(),
                    syncedOn: null,
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
}
