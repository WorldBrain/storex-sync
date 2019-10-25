export interface FastSyncSenderChannel {
    sendUserPackage(jsonSerializable: any): Promise<void>
    sendSyncInfo(syncInfo: FastSyncInfo): Promise<void>
    sendObjectBatch(batch: FastSyncBatch): Promise<void>
    finish(): Promise<void>
    destroy(): Promise<void>
}
export interface FastSyncReceiverChannel {
    receiveUserPackage(): Promise<any>
    streamObjectBatches(): AsyncIterableIterator<FastSyncBatch>
    receiveSyncInfo(): Promise<FastSyncInfo>
    destroy(): Promise<void>
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
