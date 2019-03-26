import { StorageModuleConfig, StorageOperationDefinitions } from "@worldbrain/storex-pattern-modules";

export interface SharedSyncLog {
    createDeviceId(options : {userId, sharedUntil : number}) : Promise<string>
    writeEntries(entries : SharedSyncLogEntry[]) : Promise<void>
    getUnsyncedEntries(options : { deviceId }) : Promise<SharedSyncLogEntry[]>
    updateSharedUntil(args : { until : number, deviceId }) : Promise<void>
}

export interface SharedSyncLogEntry {
    userId : any
    deviceId : any
    createdOn : number
    sharedOn : number
    data : string
}

export function createSharedSyncLogConfig(options : {autoPkType : 'int' | 'string', operations? : StorageOperationDefinitions}) : StorageModuleConfig {
    return {
        operations: options.operations,
        collections: {
            sharedSyncLogEntry: {
                version: new Date(2019, 2, 5),
                fields: {
                    userId: { type: options.autoPkType },
                    deviceId: { type: options.autoPkType },
                    createdOn: { type: 'timestamp' }, // when was this entry created on a device
                    sharedOn: { type: 'timestamp' }, // when was this entry uploaded
                    data: { type: 'string' },
                },
            },
            sharedSyncLogDeviceInfo: {
                version: new Date(2019, 2, 5),
                fields: {
                    userId: { type: options.autoPkType },
                    sharedUntil: { type: 'timestamp' },
                },
            }
        },
        methods: {
            createDeviceId: {
                type: 'mutation',
                args: {
                    userId: options.autoPkType,
                    sharedUntil: 'float'
                },
                returns: options.autoPkType
            },
            writeEntries: {
                type: 'mutation',
                args: {
                    entries: { type: { array: { collection: 'sharedSyncLogEntry' } }, positional: true },
                },
                returns: 'void'
            },
            getUnsyncedEntries: {
                type: 'query',
                args: {
                    deviceId: { type: options.autoPkType },
                },
                returns: { array: { collection: 'sharedSyncLogEntry' } },
            },
            updateSharedUntil: {
                type: 'mutation',
                args: {
                    deviceId: { type: options.autoPkType },
                    until: { type: 'float' },
                },
                returns: 'void',
            }
        }
    }
}
