import * as tmp from 'tmp'
import { runTests } from "./index.tests"
import { FilesystemSharedSyncLogStorage } from "./fs"

export function withTempDirFactory(f : (createTempDir : () => string) => void) {
    let tmpDirs = []

    const createTempDir : () => string = () => {
        const tmpDir = tmp.dirSync()
        tmpDirs.push(tmpDir)
        return tmpDir.name
    }

    afterEach(() => {
        for (const tmpDir of tmpDirs) {
            tmpDir.removeCallback()
        }
    })

    f(createTempDir)
}

describe('FilesystemSharedSyncLogStorage', () => {
    withTempDirFactory((createTempDir) => {
        async function createLog() {
            return new FilesystemSharedSyncLogStorage({
                basePath: createTempDir(),
            })
        }
        
        runTests({createLog})
    })
})
