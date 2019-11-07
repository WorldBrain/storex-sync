import { EventEmitter } from 'events'
import StorageManager from '@worldbrain/storex'
import { SharedSyncLog } from '../shared-sync-log'
import { reconcileSyncLog } from '../reconciliation'
import {
    doSync,
    SyncPreSendProcessor,
    SyncSerializer,
    SyncEvents,
    SyncPostReceiveProcessor,
    SyncOptions,
} from '../'
import { ClientSyncLogStorage } from '../client-sync-log'
import { RecurringTask } from '../utils/recurring-task'
import { SyncSettingsStore } from './settings'

export interface ContinuousSyncDependencies {
    auth: { getUserId(): Promise<number | string | null> }
    storageManager: StorageManager
    clientSyncLog: ClientSyncLogStorage
    getSharedSyncLog: () => Promise<SharedSyncLog>
    settingStore: SyncSettingsStore
    frequencyInMs?: number
    toggleSyncLogging: ((enabled: true, deviceId: string | number) => void) &
    ((enabled: false) => void)
}
export class ContinuousSync {
    public recurringIncrementalSyncTask?: RecurringTask
    public deviceId?: number | string
    public enabled = false

    constructor(private dependencies: ContinuousSyncDependencies) { }

    async setup() {
        const enabled = await this.dependencies.settingStore.retrieveSetting(
            'continuousSyncEnabled',
        )
        if (!enabled) {
            return
        }

        this.deviceId = (await this.dependencies.settingStore.retrieveSetting(
            'deviceId',
        )) as string | number
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
                (options?: { debug: boolean }) =>
                    this.maybeDoIncrementalSync(options),
                {
                    intervalInMs: this.dependencies.frequencyInMs,
                    onError: () => { },
                },
            )
        }
    }

    async initDevice() {
        const userId = await this.dependencies.auth.getUserId()
        if (!userId) {
            throw new Error(
                `Cannot generate Sync device ID without being logged in`,
            )
        }

        const existingDeviceId = await this.dependencies.settingStore.retrieveSetting(
            'deviceId',
        )
        if (existingDeviceId) {
            return
        }

        const sharedSyncLog = await this.dependencies.getSharedSyncLog()
        const newDeviceId = await sharedSyncLog.createDeviceId({
            userId,
            sharedUntil: 1,
        })
        await this.dependencies.settingStore.storeSetting(
            'deviceId',
            newDeviceId,
        )
        this.deviceId = newDeviceId
    }

    async enableContinuousSync() {
        await this.dependencies.settingStore.storeSetting(
            'continuousSyncEnabled',
            true,
        )
        await this.setupContinuousSync()
    }

    async setupContinuousSync() {
        if (!this.deviceId) {
            throw new Error(`Cannot set up continuous Sync without device id`)
        }

        this.dependencies.toggleSyncLogging(true, this.deviceId)
        this.enabled = true
        this.setupRecurringTask()
    }

    async forceIncrementalSync(options?: { debug?: boolean }) {
        if (this.enabled) {
            if (this.recurringIncrementalSyncTask) {
                await this.recurringIncrementalSyncTask.forceRun()
            } else {
                await this.doIncrementalSync(options)
            }
        }
    }

    async maybeDoIncrementalSync(options?: { debug?: boolean }) {
        if (this.enabled) {
            await this.doIncrementalSync(options)
        }
    }

    private async doIncrementalSync(options?: { debug?: boolean }) {
        const syncOptions = await this.getSyncOptions()
        if (options && options.debug) {
            syncOptions.syncEvents = new EventEmitter() as SyncEvents
            syncOptions.syncEvents.emit = ((name: string, event: any) => {
                console.log(`SYNC EVENT '${name}':`, event)
                return true
            }) as any
        }
        await doSync(syncOptions)
    }

    async getSyncOptions(): Promise<SyncOptions> {
        const { auth } = this.dependencies
        const userId = await auth.getUserId()
        if (!userId) {
            throw new Error(`Cannot Sync without authenticated user`)
        }
        if (!this.deviceId) {
            throw new Error(`Cannot Sync without device ID`)
        }

        return {
            clientSyncLog: this.dependencies.clientSyncLog,
            sharedSyncLog: await this.dependencies.getSharedSyncLog(),
            storageManager: this.dependencies.storageManager,
            reconciler: reconcileSyncLog,
            now: Date.now(),
            userId,
            deviceId: this.deviceId,
            serializer: this.getSerializer() || undefined,
            preSend: this.getPreSendProcessor() || undefined,
            postReceive: this.getPostReceiveProcessor() || undefined,
        }
    }

    getPreSendProcessor(): SyncPreSendProcessor | void { }

    getPostReceiveProcessor(): SyncPostReceiveProcessor | void { }

    getSerializer(): SyncSerializer | void { }
}
