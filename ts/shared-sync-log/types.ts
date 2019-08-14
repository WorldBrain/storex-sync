export interface SharedSyncLog {
    createDeviceId(options: { userId; sharedUntil: number }): Promise<string>
    writeEntries(
        entries: SharedSyncLogEntry[],
        options: { userId; deviceId },
    ): Promise<void>
    getUnsyncedEntries(options: { deviceId }): Promise<SharedSyncLogEntry[]>
    updateSharedUntil(args: { until: number; deviceId }): Promise<void>
}

export interface SharedSyncLogEntry {
    userId: any
    deviceId: any
    createdOn: number
    sharedOn: number
    data: string
}
