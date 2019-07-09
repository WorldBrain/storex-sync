import { EventEmitter } from "events";
import TypedEmitter from 'typed-emitter';
import StorageManager from "@worldbrain/storex";
import { FastSyncReceiverChannel, FastSyncSenderChannel } from "./types";

export class FastSyncSender {
    public events : TypedEmitter<{}> = new EventEmitter() as any
    
    constructor(private options : { storageManager : StorageManager, channel : FastSyncSenderChannel }) {
        
    }
    
    async execute() {

    }
}

export class FastSyncReceiver {
    public events : TypedEmitter<{}> = new EventEmitter() as any

    constructor(private options : { storageManager : StorageManager, channel : FastSyncReceiverChannel }) {

    }

    async execute() {

    }
}
