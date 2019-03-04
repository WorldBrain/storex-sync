import { StorageModule, StorageModuleConfig } from '@worldbrain/storex-pattern-modules'
import { SharedSyncLogEntry } from './types'

export interface SharedSyncLog {
    writeEntries(entries : SharedSyncLogEntry, options : {deviceId}) : Promise<void>
    getUnsyncedEntries(options : {deviceId}) : Promise<SharedSyncLogEntry[]>
    updateSharedUntil(args : {until : number, deviceId}) : Promise<void>
}

export class SharedSyncLogStorage extends StorageModule implements SharedSyncLog {
    getConfig() : StorageModuleConfig {
        return {
            collections: {
                sharedSyncLogEntry: {
                    version: new Date(2019, 2, 5),
                    fields: {
                        userId: {type: 'string'},
                        createdOn: {type: 'timestamp'}, // when was this entry created on a device
                        sharedOn: {type: 'timestamp'}, // when was this entry uploaded
                        data: {type: 'string'},
                    },
                },
            },
            operations: {}
        }
    }

    async writeEntries(entries : SharedSyncLogEntry, options : {deviceId}) : Promise<void> {

    }

    async getUnsyncedEntries(options : {deviceId}) : Promise<SharedSyncLogEntry[]> {
        return []
    }

    async updateSharedUntil(args : {until : number, deviceId}) : Promise<void> {

    }
}
