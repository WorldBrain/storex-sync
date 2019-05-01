import { StorageModuleConfig, StorageOperationDefinitions, AccessRules } from "@worldbrain/storex-pattern-modules";
import { CollectionDefinitionMap } from "@worldbrain/storex";
import { Omit } from "../types";

export interface SharedSyncLog {
    createDeviceId(options : {userId, sharedUntil : number}) : Promise<string>
    writeEntries(entries : Omit<SharedSyncLogEntry, 'sharedOn'>[], options? : { now? : number | '$now' }) : Promise<void>
    getUnsyncedEntries(options : { userId : string | number, deviceId : string | number }) : Promise<SharedSyncLogEntry[]>
    markAsSeen(entries : Array<{ deviceId: string | number, createdOn : number }>, options : { userId: string | number, deviceId: string | number, now?: number | '$now' }) : Promise<void>
}

export interface SharedSyncLogEntry {
    userId : any
    deviceId : any
    createdOn : number
    sharedOn : number
    data : string
}

export function createSharedSyncLogConfig(options : {
    autoPkType : 'int' | 'string',
    collections? : CollectionDefinitionMap,
    operations? : StorageOperationDefinitions,
    accessRules? : AccessRules
}) : StorageModuleConfig {
    return {
        operations: options.operations,
        collections: {
            sharedSyncLogEntry: {
                version: new Date('2019-02-05'),
                fields: {
                    userId: { type: options.autoPkType },
                    deviceId: { type: options.autoPkType },
                    createdOn: { type: 'timestamp' }, // when was this entry created on a device
                    sharedOn: { type: 'timestamp' }, // when was this entry uploaded
                    data: { type: 'string' },
                },
                groupBy: [{ key: 'userId', subcollectionName: 'entries' }],
            },
            sharedSyncLogDeviceInfo: {
                version: new Date('2019-02-05'),
                fields: {
                    userId: { type: options.autoPkType },
                    sharedUntil: { type: 'timestamp' },
                },
                groupBy: [{ key: 'userId', subcollectionName: 'devices' }]
            },
            ...(options.collections || {})
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
            markAsSeen: {
                type: 'mutation',
                args: {
                    entries: { type: { array: { object: { createdOn: 'float', deviceId: options.autoPkType }, singular: 'entry' } } },
                    deviceId: { type: options.autoPkType },
                },
                returns: 'void',
            }
        },
        accessRules: options.accessRules,
    }
}
