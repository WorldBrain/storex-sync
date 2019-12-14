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

export function splitWithTail(
    s: string,
    delimiter: string,
    limit: number,
): Array<string> {
    if (delimiter.length > 1) {
        throw new Error(`splitWithTail() doesn't support multi-char delimiters`)
    }

    const result: string[] = []

    let prevIndex: number | null = null
    let delimitersExhausted = false
    while (result.length < limit - 1) {
        const nextIndex = s.indexOf(
            delimiter,
            prevIndex === null ? 0 : prevIndex + 1,
        )
        const nextSlice = s.substring(
            prevIndex === null ? 0 : prevIndex + 1,
            nextIndex !== -1 ? nextIndex : undefined,
        )
        result.push(nextSlice)

        if (nextIndex === -1) {
            delimitersExhausted = true
            break
        }

        prevIndex = nextIndex
    }
    if (!delimitersExhausted) {
        result.push(s.substr(prevIndex === null ? 0 : prevIndex + 1))
    }

    return result
}
