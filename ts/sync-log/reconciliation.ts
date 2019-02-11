import { ClientSyncLogEntry } from "./types"

export interface ExecutableOperation {
    operation : string
    collection : string
    args : any[]
}

type Modifications = {[collection : string] : {[pk : string] : {
    shouldBeCreated : boolean
    isDeleted : boolean
    shouldBeDeleted : boolean
    fields : {[field : string] : {createdOn : number, syncedOn? : number, value : any}}
}}}

export function reconcileSyncLog(logEntries : ClientSyncLogEntry[]) : ExecutableOperation[] {
    const modificationsByObject : Modifications = {}
    for (const logEntry of logEntries) {
        const collectionModifications = modificationsByObject[logEntry.collection] = modificationsByObject[logEntry.collection] || {}
        const pkAsJson = JSON.stringify(logEntry.pk)
        const objectModifications = collectionModifications[pkAsJson]
        if (logEntry.operation === 'modify') {
            const updates = {createdOn: logEntry.createdOn, syncedOn: logEntry.syncedOn, value: logEntry.value}
            if (!objectModifications) {
                collectionModifications[pkAsJson] = {
                    shouldBeCreated: false,
                    isDeleted: !!logEntry.syncedOn,
                    shouldBeDeleted: false,
                    fields: {[logEntry.field]: updates}
                }
                continue
            }
            
            const fieldModifications = objectModifications.fields[logEntry.field]
            if (!fieldModifications) {
                objectModifications[logEntry.field] = updates
            } else if (logEntry.createdOn > fieldModifications.createdOn) {
                Object.assign(fieldModifications, updates)
            }
        } else if (logEntry.operation === 'delete') {
            const updates = {isDeleted: !!logEntry.syncedOn, shouldBeDeleted: true, fields: {}}
            if (!objectModifications) {
                collectionModifications[pkAsJson] = {shouldBeCreated: false, ...updates}
            } else (
                Object.assign(objectModifications, updates)
            )
        } else if (logEntry.operation === 'create') {
            if (!objectModifications) {
                const fields = {}
                for (const [key, value] of Object.entries(logEntry.value)) {
                    fields[key] = {value, createdOn: logEntry.createdOn, syncedOn: logEntry.syncedOn}
                }
                collectionModifications[pkAsJson] = {shouldBeCreated: true, isDeleted: false, shouldBeDeleted: false, fields}
            } else {
                if (objectModifications.shouldBeCreated) {
                    throw new Error(`Detected double create in collection '${logEntry.collection}', pk '${JSON.stringify(logEntry.pk)}'`)
                }

                const fields = objectModifications.fields
                for (const [key, value] of Object.entries(logEntry.value)) {
                    //  || logEntry.createdOn > fields[key].createdOn
                    if (!fields[key]) {
                        fields[key] = {value, createdOn: logEntry.createdOn, syncedOn: logEntry.syncedOn}
                    }
                }
                objectModifications.shouldBeCreated = true
            }
        }
    }

    const operations : ExecutableOperation[] = []
    for (const [collection, collectionModifications] of Object.entries(modificationsByObject)) {
        for (const [pkAsJson, objectModifications] of Object.entries(collectionModifications)) {
            const pk = JSON.parse(pkAsJson)
            if (objectModifications.shouldBeDeleted) {
                if (!objectModifications.isDeleted && !objectModifications.shouldBeCreated) {
                    operations.push({operation: 'deleteOneObject', collection, args: [{pk}]})
                }
            } else if (objectModifications.shouldBeCreated) {
                const object = {}
                for (const [key, fieldModification] of Object.entries(objectModifications.fields)) {
                    object[key] = fieldModification.value
                }
                operations.push({operation: 'createObject', collection, args: [object]})
            } else {
                for (const [fieldName, fieldModification] of Object.entries(objectModifications.fields)) {
                    if (!fieldModification.syncedOn) {
                        operations.push({operation: 'updateOneObject', collection, args: [{pk}, {[fieldName]: fieldModification.value}]})
                    }
                }
            }
        }
    }
    return operations
}
