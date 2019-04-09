import * as fs from 'fs'
import * as path from 'path'
import { SharedSyncLog } from '.'
import { SharedSyncLogEntry } from './types'

const BATCH_NAME_REGEX = /batch-(\d+)-device-(\d+)\.json/

export class FilesystemSharedSyncLogStorage implements SharedSyncLog {
    private fs : typeof fs
    private basePath

    constructor(options : {basePath : string, fs? : typeof fs}) {
        Object.assign(this, {...options, fs: options.fs || require('fs')})
    }

    async createDeviceId(options : {userId, sharedUntil : number}) : Promise<string> {
        const devicesPath = path.join(this.basePath, 'devices')
        if (!this.fs.existsSync(devicesPath)) {
            this.fs.mkdirSync(devicesPath)
        }
        
        const deviceId = Date.now().toFixed(0)
        const devicePath = path.join(devicesPath, deviceId)
        fs.writeFileSync(devicePath, JSON.stringify({ sharedUntil: options.sharedUntil, seen: [] }), { flag: 'w' })
        return deviceId
    }

    async writeEntries(entries : SharedSyncLogEntry[]) : Promise<void> {
        if (!entries.length) {
            return
        }
        
        const currentPath = path.join(this.basePath, 'current')
        if (!this.fs.existsSync(currentPath)) {
            this.fs.mkdirSync(currentPath)
        }

        const sharedOn = entries.reduce((prev, curr) => Math.max(curr.sharedOn, prev), 0)
        const deviceId = entries[0].deviceId
        const batchName = `batch-${sharedOn}-device-${deviceId}.json`
        const batchPath = path.join(currentPath, batchName)
        const batchContent = { entries }
        this.fs.writeFileSync(batchPath, JSON.stringify(batchContent))
    }

    async getUnsyncedEntries(options : { deviceId }) : Promise<SharedSyncLogEntry[]> {
        const currentPath = path.join(this.basePath, 'current')
        if (!this.fs.existsSync(currentPath)) {
            return []
        }
        
        const devicesPath = path.join(this.basePath, 'devices')
        if (!this.fs.existsSync(devicesPath)) {
            return []
        }
        const devicePath = path.join(devicesPath, options.deviceId)
        const deviceInfo = JSON.parse(this.fs.readFileSync(devicePath).toString())
        const seenEntries = new Set(deviceInfo.seen)
        
        const batchNames = this.fs.readdirSync(currentPath)
        
        const entries = []
        for (const batchName of batchNames) {
            const batchPath = path.join(currentPath, batchName)
            const batchContent = JSON.parse(fs.readFileSync(batchPath).toString())
            for (const entry of batchContent.entries) {
                if (!seenEntries.has(`${entry.deviceId}-${entry.createdOn}`)) {
                    entries.push(entry)
                }
            }
        }

        return entries
    }

    async markAsSeen(entries : Array<{ deviceId, createdOn : number }>, options : { deviceId }) : Promise<void> {
        const devicesPath = path.join(this.basePath, 'devices')
        const devicePath = path.join(devicesPath, options.deviceId)
        const deviceInfo = JSON.parse(this.fs.readFileSync(devicePath).toString())
        deviceInfo.seen.push(...entries.map(entry => `${entry.deviceId}-${entry.createdOn}`))
        this.fs.writeFileSync(devicePath, JSON.stringify(deviceInfo))
    }
}
