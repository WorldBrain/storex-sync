import TypedEmitter from 'typed-emitter'

export type SyncPackage<UserPackageType = any> =
    | { type: 'batch'; batch: any }
    | { type: 'confirm' }
    | { type: 'state-change'; state: 'paused' | 'running' }
    | { type: 'sync-info'; info: FastSyncInfo }
    | { type: 'finish' }
    | { type: 'user-package'; package: UserPackageType }
export interface FastSyncSenderChannelEvents {
    stalled: () => void
}
export interface FastSyncSenderChannel {
    timeoutInMiliseconds: number
    preSend?: (syncPackage: SyncPackage) => Promise<void>

    events: TypedEmitter<FastSyncSenderChannelEvents>

    sendUserPackage(jsonSerializable: any): Promise<void>
    sendSyncInfo(syncInfo: FastSyncInfo): Promise<void>
    sendObjectBatch(batch: FastSyncBatch): Promise<void>
    sendStateChange(state: 'paused' | 'running'): Promise<void>
    finish(): Promise<void>
    destroy(): Promise<void>
}
export interface FastSyncReceiverChannelEvents {
    stalled: () => void
    paused: () => void
    resumed: () => void
}
export interface FastSyncReceiverChannel {
    timeoutInMiliseconds: number
    postReceive?: (syncPackage: SyncPackage) => Promise<void>

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
