import { StorageMiddleware } from '@worldbrain/storex/lib/types/middleware'
import { ClientSyncLogStorage } from "../client-sync-log";
import StorageManager, { OperationBatch } from '@worldbrain/storex';
import { getObjectWithoutPk, getObjectPk } from '../utils';

export class SyncLoggingMiddleware implements StorageMiddleware {
    private _clientSyncLog : ClientSyncLogStorage
    private _storageManager : StorageManager

    constructor({clientSyncLog, storageManager} : {clientSyncLog : ClientSyncLogStorage, storageManager : StorageManager}) {
        this._clientSyncLog = clientSyncLog
        this._storageManager = storageManager
    }
    
    async process({next, operation} : {next : {process: ({operation}) => any}, operation : any[]}) {
        const operationType = (operation[0] as string)
        if (operationType === 'createObject') {
            const [collection, value] = operation.slice(1)
            return this._processCreateObject(next, collection, value)
        } else if (operationType === 'updateObject') {
            const [collection, where, updates] = operation.slice(1)
            return this._processUpdateObject(next, collection, where, updates)
        }

        return next.process({operation})
    }

    async _processCreateObject(next, collection : string, value : any) {
        const batch = [{placeholder: 'object', operation: 'createObject', collection, args: value}]
        batch.push({
            placeholder: 'logEntry',
            operation: 'createObject',
            collection: 'clientSyncLog',
            args: {
                collection,
                createdOn: this._getNow(),
                operation: 'create',
                pk: getObjectPk(value, collection, this._storageManager.registry),
                value: getObjectWithoutPk(value, collection, this._storageManager.registry)
            }
        })
        const result = await next.process({operation: [
            'executeBatch',
            batch
        ]})
        const object = result.info.object.object
        return {object}
    }

    _getNow() {
        return Date.now()
    }

    async _processUpdateObject(next, collection : string, where : any, updates : any) {
        const pk = getObjectPk(where, collection, this._storageManager.registry);
        const batch : OperationBatch = [{placeholder: 'object', operation: 'updateObjects', collection, where, updates}]
        for (const [fieldName, newValue] of Object.entries(updates)) {
            batch.push({
                placeholder: 'logEntry',
                operation: 'createObject',
                collection: 'clientSyncLog',
                args: {
                    createdOn: this._getNow(),
                    field: fieldName,
                    collection,
                    operation: 'modify',
                    pk: pk,
                    value: newValue
                }
            })
        }
        const result = await next.process({operation: [
            'executeBatch',
            batch
        ]})
    }
}
