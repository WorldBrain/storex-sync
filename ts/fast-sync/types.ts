import TypedEmitter from 'typed-emitter'

export type SyncPackage<UserPackageType = any> =
    | { type: 'batch'; batch: any }
    | { type: 'confirm' }
    | { type: 'state-change'; state: 'paused' | 'running' }
    | { type: 'sync-info'; info: FastSyncInfo }
    | { type: 'finish' }
    | { type: 'user-package'; package: UserPackageType }
export interface FastSyncChannelEvents {
    stalled: () => void
    paused: () => void
    resumed: () => void
}
export interface FastSyncChannel {
    timeoutInMiliseconds: number
    preSend?: (syncPackage: SyncPackage) => Promise<void>
    postReceive?: (syncPackage: SyncPackage) => Promise<void>

    events: TypedEmitter<FastSyncChannelEvents>

    sendUserPackage(jsonSerializable: any): Promise<void>
    receiveUserPackage(): Promise<any>

    sendSyncInfo(syncInfo: FastSyncInfo): Promise<void>
    receiveSyncInfo(): Promise<FastSyncInfo>

    streamObjectBatches(): AsyncIterableIterator<FastSyncBatch>
    sendObjectBatch(batch: FastSyncBatch): Promise<void>

    sendStateChange(state: 'paused' | 'running'): Promise<void>

    finish(): Promise<void>
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
