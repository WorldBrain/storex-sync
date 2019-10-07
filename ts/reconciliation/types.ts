import { StorageRegistry, OperationBatch } from '@worldbrain/storex'
import { ClientSyncLogEntry } from '../client-sync-log/types'

export type ReconcilerFunction = (
    logEntries: ClientSyncLogEntry[],
    options: { storageRegistry: StorageRegistry; debug?: boolean },
) => Promise<OperationBatch> | OperationBatch
// export interface ExecutableOperation {
//     operation: string
//     collection: string
//     args: any
// }
