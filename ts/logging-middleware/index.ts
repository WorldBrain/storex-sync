import StorageManager from '@worldbrain/storex'
import {
    StorageMiddleware,
    StorageMiddlewareContext,
} from '@worldbrain/storex/lib/types/middleware'
import { ChangeWatchMiddleware } from '@worldbrain/storex-middleware-change-watcher'
import { StorageOperationChangeInfo } from '@worldbrain/storex-middleware-change-watcher/lib/types'
import { ClientSyncLogStorage } from '../client-sync-log'
import { ClientSyncLogEntry } from '../client-sync-log/types'
import {
    OperationProcessorMap,
    DEFAULT_OPERATION_PROCESSORS,
} from './operation-processing'
import { convertChangeInfoToClientSyncLogEntries } from './change-processing'

export type SyncChangeInfoPreprocessor = (
    changeInfo: StorageOperationChangeInfo<'pre'>,
) => Promise<StorageOperationChangeInfo<'pre'> | void>
export class SyncLoggingMiddleware implements StorageMiddleware {
    public changeInfoPreprocessor: SyncChangeInfoPreprocessor | null = null

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
            mergeModifications?: boolean
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

    async process(context: StorageMiddlewareContext) {
        if (typeof context.extraData.changeInfo === 'undefined') {
            const changeWatcher = new ChangeWatchMiddleware({
                storageManager: this.options.storageManager,
                shouldWatchCollection: collection =>
                    this.includeCollections.has(collection),
            })
            return changeWatcher.process({
                operation: context.operation,
                extraData: context.extraData,
                next: {
                    process: async incoming => {
                        const extraData = {
                            ...context.extraData,
                            ...incoming.extraData,
                        }
                        return this.processWithChangeInfo({
                            operation: incoming.operation,
                            next: context.next,
                            extraData,
                        })
                    },
                },
            })
        } else {
            return this.processWithChangeInfo(context)
        }
    }

    async processWithChangeInfo({
        next,
        operation,
        extraData,
    }: StorageMiddlewareContext) {
        if (!this.enabled) {
            return next.process({ operation })
        }
        if (!this.deviceId) {
            throw new Error(
                `Cannot log sync operations without setting a device ID first`,
            )
        }
        let changeInfo: StorageOperationChangeInfo<'pre'> = extraData.changeInfo
        if (typeof changeInfo === 'undefined') {
            throw new Error(
                `Sync logging middleware didn't receive any change info`,
            )
        }
        if (!changeInfo.changes.length) {
            return next.process({ operation })
        }

        const operationType = operation[0] as string
        const operationProcessor = this.operationProcessors[operationType]
        if (!operationProcessor) {
            return next.process({ operation })
        }

        if (this.changeInfoPreprocessor) {
            const modifiedChangeInfo = await this.changeInfoPreprocessor(
                changeInfo,
            )
            if (modifiedChangeInfo) {
                changeInfo = modifiedChangeInfo
            }
            if (!changeInfo.changes.length) {
                return next.process({ operation })
            }
        }

        const logEntries = await convertChangeInfoToClientSyncLogEntries(
            changeInfo,
            {
                createMetadata: async () => ({
                    createdOn: await this._getNow(),
                    sharedOn: null,
                    deviceId: this.deviceId!,
                    needsIntegration: false,
                }),
                storageRegistry: this.options.storageManager.registry,
            },
        )

        const executeAndLog = async (
            originalOperation: any | any[],
            logEntries: ClientSyncLogEntry[],
        ) => {
            const batch =
                originalOperation instanceof Array
                    ? originalOperation
                    : [originalOperation]

            let operationIndex = -1
            for (const logEntry of logEntries) {
                operationIndex += 1

                batch.push({
                    placeholder: `logEntry-${operationIndex}`,
                    operation: 'createObject',
                    collection: 'clientSyncLogEntry',
                    args: logEntry,
                })
            }

            const result = await next.process({
                operation: ['executeBatch', batch],
            })
            return result
        }

        return operationProcessor({
            operation,
            changeInfo,
            logEntries,
            // loggedOperation,
            executeAndLog,
            mergeModifications: this.options.mergeModifications,
        })
    }

    async _getNow(): Promise<number | '$now'> {
        let now = Date.now()
        while (now === this.lastSeenNow) {
            now = Date.now()
        }
        this.lastSeenNow = now
        return now
    }
}
