import { ClientSyncLogEntry } from '../client-sync-log/types'
import { BatchOperation } from '@worldbrain/storex'
import { StorageOperationChangeInfo } from '@worldbrain/storex-middleware-change-watcher/lib/types'

export type ExecuteAndLog = (
    batchOperations: BatchOperation[],
    logEntries: ClientSyncLogEntry[],
) => Promise<any>

export interface OperationProcessorArgs {
    operation: any[]
    changeInfo: StorageOperationChangeInfo<'pre'>
    logEntries: ClientSyncLogEntry[]
    executeAndLog: ExecuteAndLog
    mergeModifications?: boolean
}
export type OperationProcessor = (args: OperationProcessorArgs) => Promise<any>
export type OperationProcessorMap = { [operation: string]: OperationProcessor }
export const DEFAULT_OPERATION_PROCESSORS: OperationProcessorMap = {
    createObject: _processCreateObject,
    executeBatch: _processExecuteBatch,
}

/**
 * Creates
 */
async function _processCreateObject(args: OperationProcessorArgs) {
    const change = args.changeInfo.changes[0]
    if (change.type !== 'create') {
        throw new Error(
            `Tried to log createObject operation, but didn't get the right change info`,
        )
    }

    const result = await args.executeAndLog(
        [
            {
                placeholder: 'object',
                operation: 'createObject',
                collection: change.collection,
                args: args.operation[2],
            },
        ],
        args.logEntries,
    )
    const object = result.info.object.object
    return { object }
}

/**
 * Batch
 */
async function _processExecuteBatch(args: OperationProcessorArgs) {
    return args.executeAndLog(args.operation[1], args.logEntries)
}
