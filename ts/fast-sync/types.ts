export interface FastSyncSenderChannel {
    sendSyncInfo: (syncInfo: FastSyncInfo) => Promise<void>
    sendObjectBatch: (batch: FastSyncBatch) => Promise<void>
    finish: () => Promise<void>
    destroy: () => Promise<void>
}
export interface FastSyncReceiverChannel {
    streamObjectBatches: () => AsyncIterableIterator<FastSyncBatch>
    receiveSyncInfo: () => Promise<FastSyncInfo>
    destroy: () => Promise<void>
}
export interface FastSyncInfo {
    objectCount: number
    collectionCount: number
}
export interface FastSyncProgress extends FastSyncInfo {
    totalObjectsProcessed: number
}
export interface FastSyncBatch {
    collection: string
    objects: any[]
}
