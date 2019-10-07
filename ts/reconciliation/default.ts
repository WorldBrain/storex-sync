import sortBy from 'lodash/sortBy'
import { StorageRegistry, OperationBatch } from '@worldbrain/storex'
import {
    ClientSyncLogEntry,
    ClientSyncLogCreationEntry,
    ClientSyncLogDeletionEntry,
    ClientSyncLogModificationEntry,
} from '../client-sync-log/types'
import { setObjectPk } from '../utils'
import { ReconcilerFunction } from './types'

type Modifications = { [collection: string]: CollectionModifications }
type CollectionModifications = { [pk: string]: ObjectModifications }
interface ObjectModifications {
    actualState: 'present' | 'absent' | 'deleted'
    action: 'ignore' | 'create' | 'update' | 'delete' | 'recreate'
    createdOn?: number | '$now'
    fields: { [field: string]: FieldModification }
}
type FieldModification = {
    createdOn: number | '$now'
    // syncedOn: number | null
    value: any
}

function _throwModificationBeforeCreation(logEntry: ClientSyncLogEntry) {
    throw new Error(
        `Detected modification to collection '${logEntry.collection}', ` +
            `pk '${JSON.stringify(
                logEntry.pk,
            )}' before it was created (likely pk collision)`,
    )
}

export const reconcileSyncLog: ReconcilerFunction = (
    logEntries: ClientSyncLogEntry[],
    options: { storageRegistry: StorageRegistry; debug?: boolean },
): OperationBatch => {
    const modificationsByObject: Modifications = {}
    for (const logEntry of sortBy(logEntries, 'createdOn')) {
        const collectionModifications = (modificationsByObject[
            logEntry.collection
        ] = modificationsByObject[logEntry.collection] || {})
        const pkAsJson = JSON.stringify(logEntry.pk)
        const objectModifications = collectionModifications[pkAsJson]

        const readableLogEntryState = logEntry.needsIntegration ? 'new' : 'old'
        if (options.debug) {
            console.log(
                `before %s (%s): %o`,
                logEntry.operation,
                readableLogEntryState,
                collectionModifications[pkAsJson],
            )
        }
        if (logEntry.operation === 'modify') {
            _processModificationEntry({
                objectModifications,
                logEntry,
                collectionModifications,
                pkAsJson,
            })
        } else if (logEntry.operation === 'delete') {
            _processDeletionEntry({
                objectModifications,
                logEntry,
                collectionModifications,
                pkAsJson,
            })
        } else if (logEntry.operation === 'create') {
            _processCreationEntry({
                objectModifications,
                logEntry,
                collectionModifications,
                pkAsJson,
            })
        }
        if (options.debug) {
            console.log(
                `after %s (%s): %o`,
                logEntry.operation,
                readableLogEntryState,
                collectionModifications[pkAsJson],
            )
        }
    }

    const operations: OperationBatch = []
    for (const [collection, collectionModifications] of Object.entries(
        modificationsByObject,
    )) {
        for (const [pkAsJson, objectModifications] of Object.entries(
            collectionModifications,
        )) {
            const pk = JSON.parse(pkAsJson)
            operations.push(
                ...(_processModifications({
                    objectModifications,
                    collection,
                    pk,
                    storageRegistry: options.storageRegistry,
                }) || []),
            )
        }
    }
    return operations
}

export function _processCreationEntry({
    objectModifications,
    logEntry,
    collectionModifications,
    pkAsJson,
}: {
    objectModifications: ObjectModifications
    logEntry: ClientSyncLogCreationEntry
    collectionModifications: CollectionModifications
    pkAsJson: any
}) {
    if (!objectModifications) {
        const fields = {}
        for (const [key, value] of Object.entries(logEntry.value)) {
            fields[key] = {
                value,
                createdOn: logEntry.createdOn,
                syncedOn: logEntry.sharedOn,
            }
        }
        if (logEntry.needsIntegration) {
            collectionModifications[pkAsJson] = {
                actualState: 'present',
                action: 'create',
                createdOn: logEntry.createdOn,
                fields,
            }
        } else {
            collectionModifications[pkAsJson] = {
                actualState: 'present',
                action: 'ignore',
                createdOn: logEntry.createdOn,
                fields,
            }
        }
    } else {
        if (objectModifications.action === 'create') {
            throw new Error(
                `Detected double create in collection '${
                    logEntry.collection
                }', pk '${JSON.stringify(logEntry.pk)}'`,
            )
        }

        const fields = objectModifications.fields
        for (const [key, value] of Object.entries(logEntry.value)) {
            if (!fields[key]) {
                fields[key] = {
                    value,
                    createdOn: logEntry.createdOn,
                    // syncedOn: logEntry.sharedOn,
                }
            } else if (logEntry.createdOn > fields[key].createdOn) {
                _throwModificationBeforeCreation(logEntry)
            }
        }

        if (
            objectModifications.action === 'delete' ||
            objectModifications.actualState === 'deleted'
        ) {
            objectModifications.action = 'recreate'
        } else {
            objectModifications.actualState = 'present'
            objectModifications.action = logEntry.needsIntegration
                ? 'create'
                : 'ignore'
        }
        objectModifications.createdOn = logEntry.createdOn
    }
}

export function _processDeletionEntry({
    objectModifications,
    logEntry,
    collectionModifications,
    pkAsJson,
}: {
    objectModifications: ObjectModifications
    logEntry: ClientSyncLogDeletionEntry
    collectionModifications: CollectionModifications
    pkAsJson: any
}) {
    // const wouldBeCreated = objectModifications
    //     ? objectModifications.actualState === 'absent' &&
    //       objectModifications.desiredState === 'present'
    //     : false

    if (objectModifications) {
        if (!logEntry.needsIntegration) {
            collectionModifications[pkAsJson] = {
                actualState: 'deleted',
                action: 'ignore',
                fields: {},
            }
        } else if (objectModifications.action === 'create') {
            collectionModifications[pkAsJson] = {
                actualState: 'absent',
                action: 'ignore',
                fields: {},
            }
        } else if (objectModifications.action === 'ignore') {
            collectionModifications[pkAsJson] = {
                actualState: 'present',
                action: 'delete',
                fields: {},
            }
        } else {
            collectionModifications[pkAsJson] = {
                actualState: 'present',
                action: 'delete',
                fields: {},
            }
        }
    } else {
        collectionModifications[pkAsJson] = {
            actualState: logEntry.needsIntegration ? 'present' : 'absent',
            action: logEntry.needsIntegration ? 'delete' : 'ignore',
            fields: {},
        }
    }
}

export function _processModificationEntry({
    objectModifications,
    logEntry,
    collectionModifications,
    pkAsJson,
}: {
    objectModifications: ObjectModifications
    logEntry: ClientSyncLogModificationEntry
    collectionModifications: CollectionModifications
    pkAsJson: any
}) {
    const updates = {
        createdOn: logEntry.createdOn,
        syncedOn: logEntry.sharedOn,
        value: logEntry.value,
    }
    if (!objectModifications) {
        collectionModifications[pkAsJson] = {
            actualState: 'present',
            action: 'update',
            fields: { [logEntry.field]: updates },
        }
        return
    }
    if (
        objectModifications.action === 'create' &&
        objectModifications.createdOn &&
        objectModifications.createdOn > logEntry.createdOn
    ) {
        _throwModificationBeforeCreation(logEntry)
    }

    const fieldModifications = objectModifications.fields[logEntry.field]
    if (!fieldModifications) {
        objectModifications[logEntry.field] = updates
    } else if (logEntry.createdOn > fieldModifications.createdOn) {
        Object.assign(fieldModifications, updates)
    }
}

export function _processModifications({
    objectModifications,
    collection,
    pk,
    storageRegistry,
}: {
    objectModifications: ObjectModifications
    collection: string
    pk: any
    storageRegistry: StorageRegistry
}): OperationBatch {
    const pkFields = setObjectPk({}, pk, collection, storageRegistry)

    const operations: OperationBatch = []
    // console.log({
    //     shouldBeDeleted: objectModifications.shouldBeDeleted,

    // })
    if (
        objectModifications.action === 'delete' ||
        objectModifications.action === 'recreate'
    ) {
        if (objectModifications.actualState !== 'deleted') {
            operations.push({
                operation: 'deleteObjects',
                collection,
                where: pkFields,
            })
        }
    }

    if (
        objectModifications.action === 'create' ||
        objectModifications.action === 'recreate'
    ) {
        const object = {}
        for (const [key, fieldModification] of Object.entries(
            objectModifications.fields,
        )) {
            object[key] = fieldModification.value
        }
        operations.push({
            operation: 'createObject',
            collection,
            args: { ...pkFields, ...object },
        })
    } else if (objectModifications.action === 'update') {
        for (const [fieldName, fieldModification] of Object.entries(
            objectModifications.fields,
        )) {
            operations.push({
                operation: 'updateObjects',
                collection,
                where: pkFields,
                updates: { [fieldName]: fieldModification.value },
            })
        }
        return operations
    }

    return operations
}
