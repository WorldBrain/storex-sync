import { SharedSyncLog } from '.'
import { SharedSyncLogEntry } from './types'

export interface Filesystem {

}

export class FilesystemSharedSyncLogStorage implements SharedSyncLog {
    private fs : Filesystem
    private basePath

    constructor(options : {basePath : string, fs? : Filesystem}) {
        Object.assign(this, {...options, fs: options.fs || require('fs')})
    }

    async createDeviceId(options : {userId, sharedUntil : number}) : Promise<string> {
        return ''
    }

    async writeEntries(entries : SharedSyncLogEntry[]) : Promise<void> {

    }

    async getUnsyncedEntries(options : { deviceId }) : Promise<SharedSyncLogEntry[]> {
        return []
    }

    async updateSharedUntil(args : { until : number, deviceId }) : Promise<void> {

    }
}
