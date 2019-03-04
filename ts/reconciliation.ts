import { ClientSyncLogEntry, ClientSyncLogCreationEntry, ClientSyncLogDeletionEntry, ClientSyncLogModificationEntry } from "./client-sync-log/types"

export interface ExecutableOperation {
    operation : string
    collection : string
    args : any[]
}

type Modifications = {[collection : string] : CollectionModifications}
type CollectionModifications = {[pk : string] : ObjectModifications}
interface ObjectModifications {
    shouldBeCreated : boolean
    createdOn? : number
    isDeleted : boolean
    shouldBeDeleted : boolean
    fields : {[field : string] : FieldModification}
}
type FieldModification = {createdOn : number, syncedOn? : number, value : any}

function _throwModificationBeforeCreation(logEntry : ClientSyncLogEntry) {
    throw new Error(
        `Detected modification to collection '${logEntry.collection}', ` +
        `pk '${JSON.stringify(logEntry.pk)}' before it was created (likely pk collision)`
    )
}

export function reconcileSyncLog(logEntries : ClientSyncLogEntry[]) : ExecutableOperation[] {
    const modificationsByObject : Modifications = {}
    for (const logEntry of logEntries) {
        const collectionModifications = modificationsByObject[logEntry.collection] = modificationsByObject[logEntry.collection] || {}
        const pkAsJson = JSON.stringify(logEntry.pk)
        const objectModifications = collectionModifications[pkAsJson]
        if (logEntry.operation === 'modify') {
            _processModificationEntry({objectModifications, logEntry, collectionModifications, pkAsJson})
        } else if (logEntry.operation === 'delete') {
            _processDeletionEntry({objectModifications, logEntry, collectionModifications, pkAsJson})
        } else if (logEntry.operation === 'create') {
            _processCreationEntry({objectModifications, logEntry, collectionModifications, pkAsJson})
        }
    }

    const operations : ExecutableOperation[] = []
    for (const [collection, collectionModifications] of Object.entries(modificationsByObject)) {
        for (const [pkAsJson, objectModifications] of Object.entries(collectionModifications)) {
            const pk = JSON.parse(pkAsJson)
            operations.push(...(_processModifications({objectModifications, collection, pk}) || []))
        }
    }
    return operations
}

export function _processCreationEntry(
    {objectModifications, logEntry, collectionModifications, pkAsJson} :
    {objectModifications : ObjectModifications, logEntry : ClientSyncLogCreationEntry,
     collectionModifications : CollectionModifications, pkAsJson : any}
) {
    if (!objectModifications) {
        const fields = {}
        for (const [key, value] of Object.entries(logEntry.value)) {
            fields[key] = {value, createdOn: logEntry.createdOn, syncedOn: logEntry.sharedOn}
        }
        collectionModifications[pkAsJson] = {
            shouldBeCreated: true, createdOn: logEntry.createdOn,
            isDeleted: false, shouldBeDeleted: false,
            fields
        }
    } else {
        if (objectModifications.shouldBeCreated) {
            throw new Error(`Detected double create in collection '${logEntry.collection}', pk '${JSON.stringify(logEntry.pk)}'`)
        }

        const fields = objectModifications.fields
        for (const [key, value] of Object.entries(logEntry.value)) {
            if (!fields[key]) {
                fields[key] = {value, createdOn: logEntry.createdOn, syncedOn: logEntry.sharedOn}
            } else if (logEntry.createdOn > fields[key].createdOn) {
                _throwModificationBeforeCreation(logEntry)
            }
        }
        objectModifications.shouldBeCreated = true
        objectModifications.createdOn = logEntry.createdOn
    }
}

export function _processDeletionEntry(
    {objectModifications, logEntry, collectionModifications, pkAsJson} :
    {objectModifications : ObjectModifications, logEntry : ClientSyncLogDeletionEntry,
     collectionModifications : CollectionModifications, pkAsJson : any}
) {
    const updates = {isDeleted: !!logEntry.sharedOn, shouldBeDeleted: true, fields: {}}
    if (!objectModifications) {
        collectionModifications[pkAsJson] = {shouldBeCreated: false, ...updates}
    } else (
        Object.assign(objectModifications, updates)
    )
}

export function _processModificationEntry(
    {objectModifications, logEntry, collectionModifications, pkAsJson} :
    {objectModifications : ObjectModifications, logEntry : ClientSyncLogModificationEntry,
     collectionModifications : CollectionModifications, pkAsJson : any}
) {
    const updates = {createdOn: logEntry.createdOn, syncedOn: logEntry.sharedOn, value: logEntry.value}
    if (!objectModifications) {
        collectionModifications[pkAsJson] = {
            shouldBeCreated: false,
            isDeleted: !!logEntry.sharedOn,
            shouldBeDeleted: false,
            fields: {[logEntry.field]: updates}
        }
        return
    }
    if (objectModifications.shouldBeCreated && objectModifications.createdOn > logEntry.createdOn) {
        _throwModificationBeforeCreation(logEntry)
    }
    
    const fieldModifications = objectModifications.fields[logEntry.field]
    if (!fieldModifications) {
        objectModifications[logEntry.field] = updates
    } else if (logEntry.createdOn > fieldModifications.createdOn) {
        Object.assign(fieldModifications, updates)
    }
}

export function _processModifications(
    {objectModifications, collection, pk} :
    {objectModifications : ObjectModifications, collection : string, pk : any}
) {
    if (objectModifications.shouldBeDeleted) {
        if (!objectModifications.isDeleted && !objectModifications.shouldBeCreated) {
            return [{operation: 'deleteOneObject', collection, args: [{pk}]}]
        }
    } else if (objectModifications.shouldBeCreated) {
        const object = {}
        for (const [key, fieldModification] of Object.entries(objectModifications.fields)) {
            object[key] = fieldModification.value
        }
        return [{operation: 'createObject', collection, args: [object]}]
    } else {
        const operations = []
        for (const [fieldName, fieldModification] of Object.entries(objectModifications.fields)) {
            if (!fieldModification.syncedOn) {
                operations.push({operation: 'updateOneObject', collection, args: [{pk}, {[fieldName]: fieldModification.value}]})
            }
        }
        return operations
    }
}
