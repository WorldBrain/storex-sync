import * as tmp from 'tmp'
import { runTests } from "./index.tests"
import { FilesystemSharedSyncLogStorage } from "./fs"

describe('SharedSyncLogStorage', () => {
    async function createLog() {
        const tmpDir = tmp.dirSync()
        return new FilesystemSharedSyncLogStorage({
            basePath: tmpDir.name,
        })
    }
    
    runTests({createLog})
})
