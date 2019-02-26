import { StorageMiddleware } from '@worldbrain/storex/lib/types/middleware'
import { ClientSyncLogStorage } from "../client-sync-log"
import StorageManager from '@worldbrain/storex'
import { ClientSyncLogEntry } from '../client-sync-log/types'
import { OperationProcessorMap, DEFAULT_OPERATION_PROCESSORS } from './operation-processors'

export class SyncLoggingMiddleware implements StorageMiddleware {
    private _clientSyncLog : ClientSyncLogStorage
    private _storageManager : StorageManager
    private _operationProcessors : OperationProcessorMap = DEFAULT_OPERATION_PROCESSORS

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
                    collection: 'clientSyncLogEntry',
                    args: logEntry
                })
            }
            return next.process({operation: [
                'executeBatch',
                batch
            ]})
        }

        const operationType = (operation[0] as string)
        const operationProcessor = this._operationProcessors[operationType]
        if (operationProcessor) {
            return operationProcessor({next, operation, executeAndLog, getNow: () => this._getNow(), storageRegistry: this._storageManager.registry})
        } else {
            return next.process({operation})
        }
    }

    _getNow() {
        return Date.now()
    }
}
