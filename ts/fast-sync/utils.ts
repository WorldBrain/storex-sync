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
