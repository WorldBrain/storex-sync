import TypedEmitter from 'typed-emitter'

export type FastSyncRole = 'sender' | 'receiver'
export const flippedRole = (role: FastSyncRole): FastSyncRole =>
    role === 'sender' ? 'receiver' : 'sender'
export type FastSyncOrder = 'receive-first' | 'send-first'
export type FastSyncPackage<
    UserPackageType = any,
    WithIndex extends boolean = true
> = (WithIndex extends true ? { index: number } : {}) &
    (
        | { type: 'sync-info'; info: FastSyncInfo }
        | { type: 'batch'; batch: any }
        | { type: 'finish' }
        | { type: 'state-change'; state: 'paused' | 'running' }
        | { type: 'user-package'; package: UserPackageType }
        | { type: 'confirm' }
    )

export interface FastSyncChannelEvents {
    stalled: () => void
    resumed: () => void
    paused: () => void
}
export interface FastSyncChannel<UserPackageType = any> {
    timeoutInMiliseconds: number
    preSend?: (syncPackage: FastSyncPackage) => Promise<void>
    postReceive?: (syncPackage: FastSyncPackage) => Promise<void>

    events: TypedEmitter<FastSyncChannelEvents>

    sendUserPackage(jsonSerializable: UserPackageType): Promise<void>
    receiveUserPackage(options?: {
        expectedType?: keyof UserPackageType
    }): Promise<UserPackageType>

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
