import * as tmp from 'tmp'
import { runTests } from "./index.tests"
import { FilesystemSharedSyncLogStorage } from "./fs"

describe('FilesystemSharedSyncLogStorage', () => {
    let tmpDirs = []

    async function createLog() {
        const tmpDir = tmp.dirSync()
        tmpDirs.push(tmpDir)
        return new FilesystemSharedSyncLogStorage({
            basePath: tmpDir.name,
        })
    }
    
    runTests({createLog})

    afterEach(() => {
        for (const tmpDir of tmpDirs) {
            tmpDir.removeCallback()
        }
    })
})
