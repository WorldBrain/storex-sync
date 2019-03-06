import { setupStorexTest } from "@worldbrain/storex-pattern-modules/lib/index.tests";
import { runTests } from "./index.tests"
import { SharedSyncLogStorage } from "./storex"

describe('SharedSyncLogStorage', () => {
    async function createLog() {
        return (await setupStorexTest<{sharedSyncLog : SharedSyncLogStorage}>({
            collections: {},
            modules: {
                sharedSyncLog: (({ storageManager }) => new SharedSyncLogStorage({ storageManager }))
            }
        })).modules.sharedSyncLog
    }
    
    runTests({createLog})
})
