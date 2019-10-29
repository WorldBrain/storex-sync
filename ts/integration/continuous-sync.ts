import StorageManager from '@worldbrain/storex'
import { SharedSyncLog } from '@worldbrain/storex-sync/lib/shared-sync-log'
import { reconcileSyncLog } from '@worldbrain/storex-sync/lib/reconciliation'
import {
    doSync,
    SyncPreSendProcessor,
    SyncSerializer,
} from '@worldbrain/storex-sync'
import { ClientSyncLogStorage } from '@worldbrain/storex-sync/lib/client-sync-log'
import { RecurringTask } from '../utils/recurring-task'
import { SyncSettingsStore } from './settings'

export interface ContinuousSyncDependencies {
    auth: { getUserId(): Promise<number | string | null> }
    storageManager: StorageManager
    clientSyncLog: ClientSyncLogStorage
    getSharedSyncLog: () => Promise<SharedSyncLog>
    settingStore: SyncSettingsStore
    frequencyInMs?: number
    toggleSyncLogging: (enabled: boolean) => void
}
export class ContinuousSync {
    public recurringIncrementalSyncTask?: RecurringTask
    public deviceId?: number | string
    public enabled = false

    constructor(
        private dependencies: ContinuousSyncDependencies,
    ) {
    }

    async setup() {
        const enabled = await this.dependencies.settingStore.retrieveSetting('continuousSyncEnabled')
        if (!enabled) {
            return
        }

        this.deviceId = (await this.dependencies.settingStore.retrieveSetting('deviceId')) as string | number
        this.setupContinuousSync()
    }

    async tearDown() {
        if (this.recurringIncrementalSyncTask) {
            this.recurringIncrementalSyncTask.stop()
        }
    }

    setupRecurringTask() {
        if (this.dependencies.frequencyInMs) {
            this.recurringIncrementalSyncTask = new RecurringTask(
                () => this.maybeDoIncrementalSync(),
                {
                    intervalInMs: this.dependencies.frequencyInMs,
                    onError: () => { },
                },
            )
        }
    }

    async initDevice() {
        const existingDeviceId = await this.dependencies.settingStore.retrieveSetting('deviceId')
        if (existingDeviceId) {
            return
        }

        const sharedSyncLog = await this.dependencies.getSharedSyncLog()
        const newDeviceId = await sharedSyncLog.createDeviceId({
            userId: await this.dependencies.auth.getUserId(),
            sharedUntil: 1,
        })
        await this.dependencies.settingStore.storeSetting('deviceId', newDeviceId)
        this.deviceId = newDeviceId
    }

    async enableContinuousSync() {
        await this.dependencies.settingStore.storeSetting('continuousSyncEnabled', true)
        await this.setupContinuousSync()
    }

    async setupContinuousSync() {
        this.dependencies.toggleSyncLogging(true)
        this.enabled = true
        this.setupRecurringTask()
    }

    async forceIncrementalSync() {
        if (this.enabled) {
            if (this.recurringIncrementalSyncTask) {
                await this.recurringIncrementalSyncTask.forceRun()
            } else {
                this.doIncrementalSync()
            }
        }
    }

    async maybeDoIncrementalSync() {
        if (this.enabled) {
            await this.doIncrementalSync()
        }
    }

    private async doIncrementalSync() {
        const { auth } = this.dependencies
        const userId = await auth.getUserId()
        if (!userId) {
            throw new Error(`Cannot Sync without authenticated user`)
        }
        await doSync({
            clientSyncLog: this.dependencies.clientSyncLog,
            sharedSyncLog: await this.dependencies.getSharedSyncLog(),
            storageManager: this.dependencies.storageManager,
            reconciler: reconcileSyncLog,
            now: Date.now(),
            userId,
            deviceId: this.deviceId,
            serializer: this.getSerializer() || undefined,
            preSend: this.getPreSendProcessor() || undefined,
        })
    }

    getPreSendProcessor(): SyncPreSendProcessor | void {

    }

    getSerializer(): SyncSerializer | void {

    }
}
