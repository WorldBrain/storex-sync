import { StorageMiddleware } from '@worldbrain/storex/lib/types/middleware'
import { ClientSyncLogStorage } from '../client-sync-log'
import StorageManager from '@worldbrain/storex'
import { ClientSyncLogEntry } from '../client-sync-log/types'
import {
    OperationProcessorMap,
    DEFAULT_OPERATION_PROCESSORS,
} from './operation-processors'

export class SyncLoggingMiddleware implements StorageMiddleware {
    private clientSyncLog: ClientSyncLogStorage
    private storageManager: StorageManager
    private operationProcessors: OperationProcessorMap = DEFAULT_OPERATION_PROCESSORS
    private includeCollections: Set<string>

    constructor(options: {
        clientSyncLog: ClientSyncLogStorage
        storageManager: StorageManager
        includeCollections: string[]
    }) {
        Object.assign(this, {
            ...options,
            includeCollections: new Set(options.includeCollections),
        })
    }

    async process({
        next,
        operation,
    }: {
        next: { process: (options: { operation: any[] }) => any }
        operation: any[]
    }) {
        const executeAndLog = (
            originalOperation: any | any[],
            logEntries: ClientSyncLogEntry[],
        ) => {
            const batch =
                originalOperation instanceof Array
                    ? originalOperation
                    : [originalOperation]
            for (const logEntry of logEntries) {
                batch.push({
                    placeholder: 'logEntry',
                    operation: 'createObject',
                    collection: 'clientSyncLogEntry',
                    args: logEntry,
                })
            }
            return next.process({ operation: ['executeBatch', batch] })
        }

        const operationType = operation[0] as string
        const operationProcessor = this.operationProcessors[operationType]
        if (operationProcessor) {
            return operationProcessor({
                next,
                operation,
                executeAndLog,
                getNow: () => this._getNow(),
                includeCollections: this.includeCollections,
                storageRegistry: this.storageManager.registry,
            })
        } else {
            return next.process({ operation })
        }
    }

    _getNow(): number | '$now' {
        return Date.now()
    }
}
