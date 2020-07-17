export interface ClientSyncLogEntryMetadata {
    createdOn: number | '$now'
    sharedOn: number
    deviceId: number | string
    needsIntegration: 0 | 1
}

export interface ClientSyncLogEntryBase extends ClientSyncLogEntryMetadata {
    id?: any
    collection: string
    pk: any
}

export interface ClientSyncLogCreationEntry extends ClientSyncLogEntryBase {
    operation: 'create'
    pk: any
    value: any
}

export type ClientSyncLogModificationEntry = ClientSyncLogEntryBase & {
    operation: 'modify'
    pk: string | number
} & ({ field: string; value: any } | { value: { [key: string]: any } })

export interface ClientSyncLogDeletionEntry extends ClientSyncLogEntryBase {
    operation: 'delete'
}

export type ClientSyncLogEntry =
    | ClientSyncLogCreationEntry
    | ClientSyncLogModificationEntry
    | ClientSyncLogDeletionEntry
