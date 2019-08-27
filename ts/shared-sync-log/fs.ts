import * as fs from 'fs'
import * as path from 'path'
import { SharedSyncLog } from '.'
import { SharedSyncLogEntry } from './types'
import { Omit } from '../types'

const BATCH_NAME_REGEX = /batch-(\d+)-device-(\d+)\.json/

export class FilesystemSharedSyncLogStorage implements SharedSyncLog {
    private fs: typeof fs
    private basePath: string

    constructor(options: { basePath: string; fs?: typeof fs }) {
        this.basePath = options.basePath
        this.fs = options.fs || require('fs')
    }

    async createDeviceId(options: {
        userId: number | string
        sharedUntil: number | null
    }): Promise<string> {
        const devicesPath = path.join(this.basePath, 'devices')
        if (!this.fs.existsSync(devicesPath)) {
            this.fs.mkdirSync(devicesPath)
        }

        const deviceId = Math.random().toString().replace('.', '')
        const devicePath = path.join(devicesPath, deviceId)
        fs.writeFileSync(
            devicePath,
            JSON.stringify({ sharedUntil: options.sharedUntil, seen: [] }),
            { flag: 'w' },
        )
        return deviceId
    }

    async writeEntries(
        entries: Omit<SharedSyncLogEntry, 'userId' | 'deviceId' | 'sharedOn'>[],
        options: {
            userId: number | string
            deviceId: string | number
            now?: number | '$now'
        },
    ): Promise<void> {
        if (!entries.length) {
            return
        }

        const currentPath = path.join(this.basePath, 'current')
        if (!this.fs.existsSync(currentPath)) {
            this.fs.mkdirSync(currentPath)
        }

        const sharedOn =
            typeof options.now === 'string' ? Date.now() : options.now
        const batchName = `batch-${sharedOn}-device-${options.deviceId}.json`
        const batchPath = path.join(currentPath, batchName)
        const batchContent = { entries, deviceId: options.deviceId, sharedOn }
        this.fs.writeFileSync(batchPath, JSON.stringify(batchContent))
    }

    async getUnsyncedEntries(options: {
        userId: string | number
        deviceId: string | number
    }): Promise<SharedSyncLogEntry[]> {
        const currentPath = path.join(this.basePath, 'current')
        if (!this.fs.existsSync(currentPath)) {
            return []
        }

        const devicesPath = path.join(this.basePath, 'devices')
        if (!this.fs.existsSync(devicesPath)) {
            return []
        }
        const devicePath = path.join(devicesPath, options.deviceId.toString())
        const deviceInfo = JSON.parse(
            this.fs.readFileSync(devicePath).toString(),
        )
        const seenEntries = new Set(deviceInfo.seen)

        const batchNames = this.fs.readdirSync(currentPath)

        const entries = []
        for (const batchName of batchNames) {
            const batchPath = path.join(currentPath, batchName)
            const batchContent = JSON.parse(
                fs.readFileSync(batchPath).toString(),
            )
            if (batchContent.deviceId === options.deviceId.toString()) {
                continue
            }

            for (const entry of batchContent.entries) {
                if (
                    !seenEntries.has(`${entry.deviceId}-${entry.createdOn}`)
                ) {
                    entries.push({
                        ...entry,
                        userId: options.userId,
                        deviceId: batchContent.deviceId,
                        sharedOn: batchContent.sharedOn,
                    })
                }
            }
        }

        return entries
    }

    async markAsSeen(
        entries: Array<{ deviceId: number | string; createdOn: number }>,
        options: { deviceId: number | string },
    ): Promise<void> {
        const devicesPath = path.join(this.basePath, 'devices')
        const devicePath = path.join(devicesPath, options.deviceId.toString())
        const deviceInfo = JSON.parse(
            this.fs.readFileSync(devicePath).toString(),
        )
        deviceInfo.seen.push(
            ...entries.map(entry => `${entry.deviceId}-${entry.createdOn}`),
        )
        this.fs.writeFileSync(devicePath, JSON.stringify(deviceInfo))
    }
}
