export interface SyncSettingsStore {
    retrieveSetting(
        key: SyncSetting
    ): Promise<SyncSettingValue>
    storeSetting(
        key: SyncSetting,
        value: SyncSettingValue,
    ): Promise<void>
}
export type SyncSetting = 'continuousSyncEnabled' | 'deviceId'
export type SyncSettingValue = boolean | number | string | null