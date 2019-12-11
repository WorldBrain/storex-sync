import { StorageMiddleware } from '@worldbrain/storex/lib/types/middleware'
import { ClientSyncLogStorage } from '../client-sync-log'
import StorageManager from '@worldbrain/storex'
import { ClientSyncLogEntry } from '../client-sync-log/types'
import {
    OperationProcessorMap,
    DEFAULT_OPERATION_PROCESSORS,
} from './operation-processors'

export type SyncLoggingOperationPreprocessor = (args: {
    operation: any[]
}) => Promise<{ operation: any[] | null }>
export class SyncLoggingMiddleware implements StorageMiddleware {
    public operationPreprocessor: SyncLoggingOperationPreprocessor | null = null

    private operationProcessors: OperationProcessorMap = DEFAULT_OPERATION_PROCESSORS
    private includeCollections: Set<string>
    private enabled = false
    private deviceId: string | number | null = null
    private lastSeenNow = 0

    constructor(
        private options: {
            clientSyncLog: ClientSyncLogStorage
            storageManager: StorageManager
            includeCollections: string[]
        },
    ) {
        this.includeCollections = new Set(options.includeCollections)
    }

    toggle(enabled: false): void
    toggle(enabled: true, deviceId: number | string): void
    toggle(enabled: boolean, deviceId?: number | string) {
        this.enabled = enabled
        this.deviceId = deviceId || null
    }

    enable(deviceId: string | number) {
        this.enabled = true
        this.deviceId = deviceId
    }

    disable() {
        this.enabled = false
    }

    async process({
        next,
        operation,
    }: {
        next: { process: (options: { operation: any[] }) => any }
        operation: any[]
    }) {
        if (!this.enabled) {
            return next.process({ operation })
        }
        if (!this.deviceId) {
            throw new Error(
                `Cannot log sync operations without setting a device ID first`,
            )
        }
        if (this.operationPreprocessor) {
            const result = await this.operationPreprocessor({ operation })
            if (result.operation) {
                operation = result.operation
            } else {
                return next.process({ operation })
            }
        }

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
                deviceId: this.deviceId,
                getNow: () => this._getNow(),
                includeCollections: this.includeCollections,
                storageRegistry: this.options.storageManager.registry,
            })
        } else {
            return next.process({ operation })
        }
    }

    async _getNow(): Promise<number | '$now'> {
        let now = Date.now()
        while (now === this.lastSeenNow) {
            await new Promise(resolve => {
                setTimeout(() => {
                    now = Date.now()
                }, 0)
            })
        }
        this.lastSeenNow = now
        return now
    }
}
