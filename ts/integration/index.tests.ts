import { MemorySignalTransportManager } from 'simple-signalling/lib/memory'
import StorageManager from '@worldbrain/storex'
import { DexieStorageBackend } from '@worldbrain/storex-backend-dexie'
import inMemory from '@worldbrain/storex-backend-dexie/lib/in-memory'
import { SharedSyncLogStorage } from '../shared-sync-log/storex'
import { registerModuleMapCollections } from '@worldbrain/storex-pattern-modules'

export function lazyMemorySignalTransportFactory() {
    let manager: MemorySignalTransportManager
    return () => {
        if (!manager) {
            manager = new MemorySignalTransportManager()
        }

        return manager.createTransport()
    }
}

export async function createMemorySharedSyncLog() {
    const sharedStorageManager = new StorageManager({
        backend: new DexieStorageBackend({
            dbName: 'shared',
            idbImplementation: inMemory(),
        }),
    })
    const sharedSyncLog = new SharedSyncLogStorage({
        storageManager: sharedStorageManager,
        autoPkType: 'int',
    })
    registerModuleMapCollections(sharedStorageManager.registry, {
        sharedSyncLog,
    })
    await sharedStorageManager.finishInitialization()
    return sharedSyncLog
}
