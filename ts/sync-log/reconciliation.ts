import { ClientSyncLogEntry } from "./types"

export interface ExecutableOperation {
    operation : string
    collection : string
    args : any[]
}

type Modifications = {[collection : string] : {[pk : string] : {
    isDeleted : boolean
    shouldBeDeleted : boolean
    fields : {[field : string] : {timestamp : number, value : any}}
}}}

export function reconcileSyncLog(logEntries : ClientSyncLogEntry[]) : ExecutableOperation[] {
    const modificationsByObject : Modifications = {}
    for (const logEntry of logEntries) {
        const collectionModifications = modificationsByObject[logEntry.collection] = modificationsByObject[logEntry.collection] || {}
        const pkAsJson = JSON.stringify(logEntry.pk)
        const objectModifications = collectionModifications[pkAsJson]
        if (logEntry.operation === 'modify') {
            const updates = {timestamp: logEntry.createdOn, value: logEntry.value}
            if (!objectModifications) {
                collectionModifications[pkAsJson] = {
                    isDeleted: !!logEntry.syncedOn,
                    shouldBeDeleted: false,
                    fields: {[logEntry.field]: updates}
                }
                continue
            }
            
            const fieldModifications = objectModifications.fields[logEntry.field]
            if (!fieldModifications) {
                objectModifications[logEntry.field] = updates
            } else if (logEntry.createdOn > fieldModifications.timestamp) {
                Object.assign(fieldModifications, updates)
            }
        } else if (logEntry.operation === 'delete') {
            const updates = {isDeleted: !!logEntry.syncedOn, shouldBeDeleted: true, fields: {}}
            if (!objectModifications) {
                collectionModifications[pkAsJson] = updates
            } else (
                Object.assign(objectModifications, updates)
            )
        }
    }

    const operations : ExecutableOperation[] = []
    for (const [collection, collectionModifications] of Object.entries(modificationsByObject)) {
        for (const [pkAsJson, objectModifications] of Object.entries(collectionModifications)) {
            const pk = JSON.parse(pkAsJson)
            if (objectModifications.shouldBeDeleted) {
                if (!objectModifications.isDeleted) {
                    operations.push({operation: 'deleteOneObject', collection, args: [{pk}]})
                }
                continue
            }

            for (const [fieldName, fieldModification] of Object.entries(objectModifications.fields)) {
                operations.push({operation: 'updateOneObject', collection, args: [{pk}, {[fieldName]: fieldModification.value}]})
            }
        }
    }
    return operations
}
