import { StorageRegistry, OperationBatch } from '@worldbrain/storex'
import { ClientSyncLogEntry } from '../client-sync-log/types'

export type ReconcilerFunction = (
    logEntries: ClientSyncLogEntry[],
    options: {
        storageRegistry: StorageRegistry
        doubleCreateBehaviour?: DoubleCreateBehaviour
        debug?: boolean
    },
) => Promise<OperationBatch> | OperationBatch
export type DoubleCreateBehaviour = 'error' | 'merge'
// export interface ExecutableOperation {
//     operation: string
//     collection: string
//     args: any
// }
