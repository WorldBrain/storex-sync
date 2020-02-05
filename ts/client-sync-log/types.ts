interface ClientSyncLogEntryBase {
    id?: any
    createdOn: number | '$now'
    sharedOn: number | null
    deviceId: number | string
    needsIntegration: boolean
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
