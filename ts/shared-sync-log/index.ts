import { StorageModule, StorageModuleConfig } from '@worldbrain/storex-pattern-modules'

export class SharedSyncLogStorage extends StorageModule {
    getConfig() : StorageModuleConfig {
        return {
            collections: {},
            operations: {}
        }
    }
}
