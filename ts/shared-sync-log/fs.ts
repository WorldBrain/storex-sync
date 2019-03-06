import * as fs from 'fs'
import { SharedSyncLog } from '.';

export interface Filesystem {

}

export class FilesystemSharedSyncLog implements SharedSyncLog {
    private _fs : Filesystem
}
