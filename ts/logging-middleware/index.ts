import { StorageMiddleware } from '@worldbrain/storex/lib/types/middleware'
import { ClientSyncLogStorage } from "../client-sync-log";
import StorageManager from '@worldbrain/storex';
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
            const [collection, value] = [operation[1], operation[2]]
            const batch = [{placeholder: 'object', operation: operationType, collection, args: value}]
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

        return next.process({operation})
    }

    _getNow() {
        return Date.now()
    }
}
