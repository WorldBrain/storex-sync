import { ResolvablePromise, resolvablePromise } from './utils'

export default class Interruptable {
    cancelled: boolean = false
    private pausePromise: ResolvablePromise<void> | null = null // only set if paused, resolved when pause ends

    get paused(): boolean {
        return !!this.pausePromise
    }

    async cancel() {
        this.cancelled = true
    }

    async pause() {
        if (this.paused || this.cancelled) {
            return
        }

        this.pausePromise = resolvablePromise()
    }

    async resume() {
        if (this.pausePromise) {
            this.pausePromise.resolve()
            this.pausePromise = null
        }
    }

    async whileLoop(
        condition: () => Promise<boolean>,
        body: () => Promise<void>,
    ) {
        if (!this.cancelled) {
            while (await condition()) {
                if (await this._shouldCancelAfterWaitingForPause()) {
                    break
                }

                await body()
            }
        }
    }

    async forOfLoop<T>(
        iterable: Iterable<T> | AsyncIterable<T>,
        body: (item: T) => Promise<void>,
    ) {
        if (this.cancelled) {
            return
        }

        if (iterable[Symbol.asyncIterator]) {
            for await (const item of iterable) {
                if (await this._shouldCancelAfterWaitingForPause()) {
                    break
                }

                await body(item)

                if (await this._shouldCancelAfterWaitingForPause()) {
                    break
                }
            }
        } else {
            for (const item of iterable as Iterable<T>) {
                if (await this._shouldCancelAfterWaitingForPause()) {
                    break
                }

                await body(item)
            }
        }
    }

    async execute(f: () => Promise<void>) {
        if (await this._shouldCancelAfterWaitingForPause()) {
            return
        }

        return f()
    }

    async _shouldCancelAfterWaitingForPause() {
        if (this.pausePromise) {
            await this.pausePromise.promise
        }
        return this.cancelled
    }
}
