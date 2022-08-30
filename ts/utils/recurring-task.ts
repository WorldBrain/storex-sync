export class RecurringTask<TaskOptions = void, TaskReturnType = void> {
    // taskRunning = false // TODO: Write tests before introducing this feature
    aproximateNextRun: number | null = null
    private timeoutId: ReturnType<typeof setTimeout> | null = null

    constructor(
        private task: (options?: TaskOptions) => Promise<TaskReturnType>,
        private options: {
            intervalInMs: number
            onError: (error: Error) => void
            setTimeout?: (
                f: () => void,
                miliseconds: number,
            ) => ReturnType<typeof setTimeout>
            clearTimeout?: (timeoutId: ReturnType<typeof setTimeout>) => void
        },
    ) {
        this.schedule()
    }

    stop() {
        this.clearTimeout()
        this.aproximateNextRun = null
    }

    async forceRun(options?: TaskOptions) {
        this.clearTimeout()
        try {
            const result = await this.run(options)
            return result
        } catch (e) {
            this.options.onError(e)
            throw e
        }
    }

    private schedule() {
        if (this.timeoutId) {
            this.clearTimeout()
        }

        const { intervalInMs } = this.options
        const now = Date.now()
        this.aproximateNextRun = now + intervalInMs
        this.timeoutId = (this.options.setTimeout || setTimeout)(async () => {
            try {
                await this.run()
            } catch (e) {
                this.options.onError(e)
            }
        }, intervalInMs)
    }

    private async run(options?: TaskOptions) {
        // this.taskRunning = true
        try {
            return this.task(options)
        } finally {
            this.schedule()
            // this.taskRunning = false
        }
    }

    private clearTimeout() {
        if (this.timeoutId) {
            ;(this.options.clearTimeout || clearTimeout)(this.timeoutId)
            this.timeoutId = null
        }
    }
}
