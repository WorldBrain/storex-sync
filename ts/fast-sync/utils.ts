import StorageManager from '@worldbrain/storex'
import { FastSyncInfo } from './types'

export type ResolvablePromise<ReturnType> = {
    promise: Promise<ReturnType>
    resolve: (value: ReturnType) => void
}

export function resolvablePromise<ReturnType>(): ResolvablePromise<ReturnType> {
    let resolve: (value: ReturnType) => void
    const promise = new Promise<ReturnType>(resolvePromise => {
        resolve = resolvePromise
    })
    return { resolve: resolve!, promise }
}

export async function getFastSyncInfo(
    storageManager: StorageManager,
): Promise<FastSyncInfo> {
    let collectionCount = 0
    let objectCount = 0
    for (const collectionName of Object.keys(
        storageManager.registry.collections,
    )) {
        collectionCount += 1
        objectCount += await storageManager
            .collection(collectionName)
            .countObjects({})
    }
    return { collectionCount, objectCount }
}
