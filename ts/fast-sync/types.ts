import TypedEmitter from 'typed-emitter'

export interface FastSyncSenderChannel {
    sendUserPackage(jsonSerializable: any): Promise<void>
    sendSyncInfo(syncInfo: FastSyncInfo): Promise<void>
    sendObjectBatch(batch: FastSyncBatch): Promise<void>
    sendStateChange(state: 'paused' | 'running'): Promise<void>
    finish(): Promise<void>
    destroy(): Promise<void>
}
export interface FastSyncReceiverChannelEvents {
    paused: () => void
    resumed: () => void
}
export interface FastSyncReceiverChannel {
    events: TypedEmitter<FastSyncReceiverChannelEvents>

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
