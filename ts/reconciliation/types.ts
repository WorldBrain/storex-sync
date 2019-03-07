import { StorageRegistry } from "@worldbrain/storex";
import { ClientSyncLogEntry } from "../client-sync-log/types";

export type ReconcilerFunction = (logEntries : ClientSyncLogEntry[], options : {storageRegistry : StorageRegistry}) => Promise<ExecutableOperation[]> | ExecutableOperation[]
export interface ExecutableOperation {
    operation : string
    collection : string
    args : any[]
}
