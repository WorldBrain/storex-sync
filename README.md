This package provides Sync functionality between multiple instances of any applications built on [Storex](https://github.com/WorldBrain/storex). This includes:

* Multiple devices that run an application storing all of it data data in IndexedDB
* Multiple SQL databases asynchronously sync'ed, like product catelogues in different physical shops
* In the future, offline-first single-user applications storing their data both on devices and in the cloud

By itself, right now this package cannot provide offline-first for multi-user application due to the need for access right management. That being said, its code is modular enough to be able to evolve to support such a scenario, opening up the possibility for permission decentralized applications.

How it works
============

1) When you set up Storex as the storage layer for your application (with IndexedDB as the backend for example) you set it up with the Custom PK and Sync Log [middleware](https://github.com/WorldBrain/storex/blob/master/docs/middleware.md).
1a) The Custom PK middleware generates a random ID for each new object instead of an auto-incremented ID to prevent ID conflicts between devices
1b) The Sync Log middleware intercepts all modifications to the database and also writes them to the Client Sync Log
2) Once in a while you sync the Client Log with the Shared Log, sending and receiving changes
3) When new changes are received, the Reconciliation Algorithm is ran to determine which changes have to be made to the client database, and execute them

Usage
=====

```
import uuid from 'uuid/v1'
import StorageManager, { StorageBackend, StorageRegistry } from "@worldbrain/storex"
import { registerModuleMapCollections, StorageModule } from "@worldbrain/storex-pattern-modules"

import { CustomAutoPkMiddleware } from '@worldbrain/storex-sync/lib/custom-auto-pk'
import { SyncLoggingMiddleware } from '@worldbrain/storex-sync/lib/logging-middleware'
import { ClientSyncLogStorage } from '@worldbrain/storex-sync/lib/client-sync-log'
import { SharedSyncLog } from '@worldbrain/storex-sync/lib/shared-sync-log'
import { SharedSyncLogStorage } from '@worldbrain/storex-sync/lib/shared-sync-log/storex'
import { reconcileSyncLog } from '@worldbrain/storex-sync/lib/reconciliation'
import { doSync } from '@worldbrain/storex-sync'

export async function setupClientStorage() {
    const storageManager = ... // Set up your storage backend, manager, modules and collections here
    const clientSyncLog = new ClientSyncLogStorage({storageManager})
    registerModuleMapCollections({ clientSyncLog })
    await storageManager.finishInitialization()

    // Prevent auto-incremented ID clashes by generating UUIDs instead
    const pkMiddleware = new CustomAutoPkMiddleware({ pkGenerator: () => uuid() })
    pkMiddleware.setup({ storageRegistry: storageManager.registry, collections: includeCollections })

    const syncLoggingMiddleware = new SyncLoggingMiddleware({ storageManager, clientSyncLog: modules.clientSyncLog, includeCollections })
    syncLoggingMiddleware._getNow = options.getNow

    storageManager.setMiddleware([
        pkMiddleware,
        syncLoggingMiddleware
    ])
    
    // From now on, all write operations will be logged to the Sync log
    await storageManager.collection('user').createObject({ displayName: 'Joe' })
}

export async function sync(options : { storageManager : StorageManager, clientSyncLog : ClientSyncLog, sharedSyncLog : SharedSyncLog }) {
    await doSync({
        storageManager, clientSyncLog, sharedSyncLog,

        // The default reconciliation algorithm, swappable
        reconciler: reconcileSyncLog,
        
        // For unit test, it may be useful to specify a custom timestamp here
        now: '$now',
        
        // This depends on the user management of your application
        userId,
        
        // This can be created with `sharedSyncLog.createDeviceId({ ... })`
        deviceId
    })
}
```

The shared sync log
===================

As mentioned above, Sync works by sending and receiving changes from a shared log. Currently, we have working PoCs of doing this through GraphQL to a custom back-end, through Firestore, the local Filesystem and entirely within the same browser for testing purposes. However, all that's neded for a different kind of shared log is implementing the [SharedSyncLog interface](./ts/shared-sync-log/types.ts) and passing that into the `doSync()` function as shown above. Example implementations can be found [here](./ts/shared-sync-log/storex.ts) and [here](./ts/shared-sync-log/fs.ts).


Deeper understanding
====================

Since this a complex piece of software that with the risk that it brings with it, it's highly recommended to dive into the code and get a thorough understand of it before implementing any of this in your own application. The best point to start would be the [integration tests](./ts/index.test.ts) and drilling down from there.
