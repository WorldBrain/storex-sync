interface ClientSyncLogEntryBase {
    id?: any
    createdOn : number
    sharedOn? : number
    needsIntegration : boolean
    collection : string
    pk : any
}

export interface ClientSyncLogCreationEntry extends ClientSyncLogEntryBase {
    operation : 'create'
    pk : any
    value : any
}

export interface ClientSyncLogModificationEntry extends ClientSyncLogEntryBase {
    operation : 'modify'
    pk : any
    field : string
    value : any
}

export interface ClientSyncLogDeletionEntry extends ClientSyncLogEntryBase {
    operation : 'delete'
}

export type ClientSyncLogEntry = ClientSyncLogCreationEntry | ClientSyncLogModificationEntry | ClientSyncLogDeletionEntry