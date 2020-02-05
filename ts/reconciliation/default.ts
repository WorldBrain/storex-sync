import omit from 'lodash/omit'
import sortBy from 'lodash/sortBy'
import { StorageRegistry, OperationBatch } from '@worldbrain/storex'
import {
    ClientSyncLogEntry,
    ClientSyncLogCreationEntry,
    ClientSyncLogDeletionEntry,
    ClientSyncLogModificationEntry,
} from '../client-sync-log/types'
import { setObjectPk } from '../utils'
import { ReconcilerFunction, DoubleCreateBehaviour } from './types'

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

export const reconcileSyncLog: ReconcilerFunction = (
    logEntries: ClientSyncLogEntry[],
    options: {
        storageRegistry: StorageRegistry
        doubleCreateBehaviour?: DoubleCreateBehaviour
        debug?: boolean
    },
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
                doubleCreateBehaviour: options.doubleCreateBehaviour,
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
    doubleCreateBehaviour,
}: {
    objectModifications: ObjectModifications
    logEntry: ClientSyncLogCreationEntry
    collectionModifications: CollectionModifications
    pkAsJson: any
    doubleCreateBehaviour?: DoubleCreateBehaviour
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
                actualState: 'absent',
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
            if (doubleCreateBehaviour !== 'merge') {
                throw new Error(
                    `Detected double create in collection '${
                        logEntry.collection
                    }', pk '${JSON.stringify(logEntry.pk)}'`,
                )
            }
        }

        const fields = objectModifications.fields
        for (const [key, value] of Object.entries(logEntry.value)) {
            fields[key] = {
                value,
                createdOn: logEntry.createdOn,
                // syncedOn: logEntry.sharedOn,
            }
        }

        // console.log(objectModifications)
        if (
            objectModifications.action === 'delete' ||
            objectModifications.actualState === 'deleted'
        ) {
            objectModifications.action = 'recreate'
        } else if (objectModifications.actualState === 'present') {
            if (logEntry.needsIntegration) {
                if (objectModifications.actualState === 'present') {
                    objectModifications.action = 'update'
                } else {
                    objectModifications.action = 'create'
                }
            }
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
    const updateField = (
        objectModifications: ObjectModifications,
        fieldName: string,
        value: any,
        createdOn: number,
    ) => {
        if (objectModifications.fields[fieldName]) {
            if (
                logEntry.createdOn >
                objectModifications.fields[fieldName].createdOn
            ) {
                objectModifications.fields[fieldName].value = value
            }
        } else {
            objectModifications.fields[fieldName] = {
                createdOn,
                value,
            }
        }
    }
    const updateFields = (objectModifications: ObjectModifications) => {
        if ('field' in logEntry && logEntry.field) {
            // old format, single field per entry
            updateField(
                objectModifications,
                logEntry.field,
                logEntry.value,
                logEntry.createdOn as number,
            )
        } else {
            for (const [fieldName, value] of Object.entries(logEntry.value)) {
                updateField(
                    objectModifications,
                    fieldName,
                    value,
                    logEntry.createdOn as number,
                )
            }
        }
    }

    if (!objectModifications) {
        collectionModifications[pkAsJson] = {
            actualState: 'present',
            action: 'update',
            fields: {},
        }
        updateFields(collectionModifications[pkAsJson])
        return
    }

    updateFields(objectModifications)

    if (
        objectModifications.actualState === 'present' &&
        objectModifications.action === 'ignore'
    ) {
        objectModifications.action = 'update'
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
            if (Object.keys(pkFields).includes(fieldName)) {
                continue
            }

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
