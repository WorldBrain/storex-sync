import expect from 'expect'
import StorageManager, {
    CollectionFields,
    IndexDefinition,
} from '@worldbrain/storex'
import { DexieStorageBackend } from '@worldbrain/storex-backend-dexie'
import inMemory from '@worldbrain/storex-backend-dexie/lib/in-memory'
import { registerModuleCollections } from '@worldbrain/storex-pattern-modules'
import { ClientSyncLogStorage } from '../client-sync-log'
import { SyncLoggingMiddleware } from '.'

async function setupTest(options: {
    now: () => number
    deviceId?: string | null
    userFields?: CollectionFields
    userIndices?: IndexDefinition[]
}) {
    const backend = new DexieStorageBackend({
        idbImplementation: inMemory(),
        dbName: 'unittest',
    })
    const storageManager = new StorageManager({ backend: backend as any })
    storageManager.registry.registerCollections({
        user: {
            version: new Date('2019-02-19'),
            fields: options.userFields || {
                displayName: { type: 'string' },
            },
            indices: options.userIndices,
        },
    })
    const clientSyncLog = new ClientSyncLogStorage({ storageManager })
    registerModuleCollections(storageManager.registry, clientSyncLog)
    await storageManager.finishInitialization()
    const loggingMiddleware = new SyncLoggingMiddleware({
        clientSyncLog,
        storageManager,
        includeCollections: ['user'],
    })
    if (options.deviceId !== null) {
        loggingMiddleware.enable(
            typeof options.deviceId !== 'undefined'
                ? options.deviceId
                : 'device-one',
        )
    }
    loggingMiddleware._getNow = async () => options.now()
    storageManager.setMiddleware([loggingMiddleware])
    return { storageManager, clientSyncLog, loggingMiddleware }
}

describe('Sync logging middleware', () => {
    it('should write createObject operations to the ClientSyncLog in a batch write', async () => {
        const { storageManager, clientSyncLog } = await setupTest({
            now: () => 3,
        })
        await storageManager
            .collection('user')
            .createObject({ id: 53, displayName: 'John Doe' })
        expect(await clientSyncLog.getEntriesCreatedAfter(1)).toEqual([
            {
                deviceId: 'device-one',
                createdOn: 3,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 53,
                operation: 'create',
                value: { displayName: 'John Doe' },
            },
        ])
    })

    it('should write updateObject operations done by pk on a single field to the ClientSyncLog in a batch write', async () => {
        let now = 2
        const { storageManager, clientSyncLog } = await setupTest({
            now: () => ++now,
        })
        await storageManager
            .collection('user')
            .createObject({ id: 53, displayName: 'John Doe' })
        await storageManager
            .collection('user')
            .updateOneObject({ id: 53 }, { displayName: 'Jack Doe' })
        expect(await clientSyncLog.getEntriesCreatedAfter(1)).toEqual([
            {
                deviceId: 'device-one',
                createdOn: 3,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 53,
                operation: 'create',
                value: { displayName: 'John Doe' },
            },
            {
                deviceId: 'device-one',
                createdOn: 4,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 53,
                operation: 'modify',
                field: 'displayName',
                value: 'Jack Doe',
            },
        ])
    })

    it('should write updateObject operations done by pk on multiple fields to the ClientSyncLog in a batch write', async () => {
        let now = 2
        const { storageManager, clientSyncLog } = await setupTest({
            now: () => ++now,
            userFields: {
                firstName: { type: 'string' },
                lastName: { type: 'string' },
            },
        })
        await storageManager
            .collection('user')
            .createObject({ id: 53, firstName: 'John', lastName: 'Doe' })
        await storageManager
            .collection('user')
            .updateOneObject(
                { id: 53 },
                { firstName: 'Jack', lastName: 'Trump' },
            )
        expect(await clientSyncLog.getEntriesCreatedAfter(1)).toEqual([
            {
                deviceId: 'device-one',
                createdOn: 3,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 53,
                operation: 'create',
                value: { firstName: 'John', lastName: 'Doe' },
            },
            {
                deviceId: 'device-one',
                createdOn: 4,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 53,
                operation: 'modify',
                field: 'firstName',
                value: 'Jack',
            },
            {
                deviceId: 'device-one',
                createdOn: 5,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 53,
                operation: 'modify',
                field: 'lastName',
                value: 'Trump',
            },
        ])
    })

    it('should write updateObjects operations done on a single field to the ClientSyncLog in a batch write', async () => {
        let now = 2
        const { storageManager, clientSyncLog } = await setupTest({
            now: () => ++now,
            userFields: {
                firstName: { type: 'string' },
                lastName: { type: 'string' },
            },
        })
        await storageManager
            .collection('user')
            .createObject({ id: 53, firstName: 'John', lastName: 'Doe' })
        await storageManager
            .collection('user')
            .createObject({ id: 54, firstName: 'Jane', lastName: 'Doe' })
        await storageManager
            .collection('user')
            .createObject({ id: 55, firstName: 'Jack', lastName: 'Daniels' })
        await storageManager
            .collection('user')
            .updateObjects({ lastName: 'Doe' }, { lastName: 'Trump' })
        expect(await clientSyncLog.getEntriesCreatedAfter(1)).toEqual([
            {
                deviceId: 'device-one',
                createdOn: 3,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 53,
                operation: 'create',
                value: { firstName: 'John', lastName: 'Doe' },
            },
            {
                deviceId: 'device-one',
                createdOn: 4,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 54,
                operation: 'create',
                value: { firstName: 'Jane', lastName: 'Doe' },
            },
            {
                deviceId: 'device-one',
                createdOn: 5,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 55,
                operation: 'create',
                value: { firstName: 'Jack', lastName: 'Daniels' },
            },
            {
                deviceId: 'device-one',
                createdOn: 6,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 53,
                operation: 'modify',
                field: 'lastName',
                value: 'Trump',
            },
            {
                deviceId: 'device-one',
                createdOn: 7,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 54,
                operation: 'modify',
                field: 'lastName',
                value: 'Trump',
            },
        ])
    })

    it('should write updateObjects operations done on multiple fields to the ClientSyncLog in a batch write', async () => {
        let now = 2
        const { storageManager, clientSyncLog } = await setupTest({
            now: () => ++now,
            userFields: {
                firstName: { type: 'string' },
                lastName: { type: 'string' },
            },
        })
        await storageManager
            .collection('user')
            .createObject({ id: 53, firstName: 'John', lastName: 'Doe' })
        await storageManager
            .collection('user')
            .createObject({ id: 54, firstName: 'Jane', lastName: 'Doe' })
        await storageManager
            .collection('user')
            .createObject({ id: 55, firstName: 'Jack', lastName: 'Daniels' })
        await storageManager
            .collection('user')
            .updateObjects(
                { lastName: 'Doe' },
                { firstName: 'Pinata', lastName: 'Trump' },
            )
        expect(await clientSyncLog.getEntriesCreatedAfter(1)).toEqual([
            {
                deviceId: 'device-one',
                createdOn: 3,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 53,
                operation: 'create',
                value: { firstName: 'John', lastName: 'Doe' },
            },
            {
                deviceId: 'device-one',
                createdOn: 4,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 54,
                operation: 'create',
                value: { firstName: 'Jane', lastName: 'Doe' },
            },
            {
                deviceId: 'device-one',
                createdOn: 5,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 55,
                operation: 'create',
                value: { firstName: 'Jack', lastName: 'Daniels' },
            },
            {
                deviceId: 'device-one',
                createdOn: 6,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 53,
                operation: 'modify',
                field: 'firstName',
                value: 'Pinata',
            },
            {
                deviceId: 'device-one',
                createdOn: 7,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 53,
                operation: 'modify',
                field: 'lastName',
                value: 'Trump',
            },
            {
                deviceId: 'device-one',
                createdOn: 8,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 54,
                operation: 'modify',
                field: 'firstName',
                value: 'Pinata',
            },
            {
                deviceId: 'device-one',
                createdOn: 9,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 54,
                operation: 'modify',
                field: 'lastName',
                value: 'Trump',
            },
        ])
    })

    it('should correctly process batch operations with createObject operations', async () => {
        let now = 2
        const { storageManager, clientSyncLog } = await setupTest({
            now: () => ++now,
        })
        await storageManager.operation('executeBatch', [
            {
                placeholder: 'john',
                operation: 'createObject',
                collection: 'user',
                args: { id: 53, displayName: 'John Doe' },
            },
            {
                placeholder: 'jane',
                operation: 'createObject',
                collection: 'user',
                args: { id: 54, displayName: 'Jane Does' },
            },
        ])
        expect(await clientSyncLog.getEntriesCreatedAfter(1)).toEqual([
            {
                deviceId: 'device-one',
                createdOn: 3,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 53,
                operation: 'create',
                value: { displayName: 'John Doe' },
            },
            {
                deviceId: 'device-one',
                createdOn: 4,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 54,
                operation: 'create',
                value: { displayName: 'Jane Does' },
            },
        ])
    })

    it('should write deleteObject operations done by pk to the ClientSyncLog in a batch write', async () => {
        let now = 2
        const { storageManager, clientSyncLog } = await setupTest({
            now: () => ++now,
        })
        await storageManager
            .collection('user')
            .createObject({ id: 53, displayName: 'John Doe' })
        await storageManager.collection('user').deleteOneObject({ id: 53 })
        expect(await clientSyncLog.getEntriesCreatedAfter(1)).toEqual([
            {
                deviceId: 'device-one',
                createdOn: 3,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 53,
                operation: 'create',
                value: { displayName: 'John Doe' },
            },
            {
                deviceId: 'device-one',
                createdOn: 4,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 53,
                operation: 'delete',
            },
        ])
    })

    it('should write deleteObjects operations done by a query on a single field to the ClientSyncLog in a batch write', async () => {
        let now = 2
        const { storageManager, clientSyncLog } = await setupTest({
            now: () => ++now,
        })
        await storageManager
            .collection('user')
            .createObject({ id: 53, firstName: 'John', lastName: 'Doe' })
        await storageManager
            .collection('user')
            .deleteObjects({ firstName: 'John', lastName: 'Doe' })
        expect(await clientSyncLog.getEntriesCreatedAfter(1)).toEqual([
            {
                deviceId: 'device-one',
                createdOn: 3,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 53,
                operation: 'create',
                value: { firstName: 'John', lastName: 'Doe' },
            },
            {
                deviceId: 'device-one',
                createdOn: 4,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 53,
                operation: 'delete',
            },
        ])
    })

    it('should write deleteObjects operations done by a query on multiple fields to the ClientSyncLog in a batch write', async () => {
        let now = 2
        const { storageManager, clientSyncLog } = await setupTest({
            now: () => ++now,
        })
        await storageManager
            .collection('user')
            .createObject({ id: 53, firstName: 'John', lastName: 'Doe' })
        await storageManager
            .collection('user')
            .createObject({ id: 54, firstName: 'John', lastName: 'Paul' })
        await storageManager
            .collection('user')
            .createObject({ id: 55, firstName: 'Jess', lastName: 'Doe' })
        await storageManager
            .collection('user')
            .deleteObjects({ firstName: 'John', lastName: 'Doe' })
        expect(await clientSyncLog.getEntriesCreatedAfter(1)).toEqual([
            {
                deviceId: 'device-one',
                createdOn: 3,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 53,
                operation: 'create',
                value: { firstName: 'John', lastName: 'Doe' },
            },
            {
                deviceId: 'device-one',
                createdOn: 4,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 54,
                operation: 'create',
                value: { firstName: 'John', lastName: 'Paul' },
            },
            {
                deviceId: 'device-one',
                createdOn: 5,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 55,
                operation: 'create',
                value: { firstName: 'Jess', lastName: 'Doe' },
            },
            {
                deviceId: 'device-one',
                createdOn: 6,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 53,
                operation: 'delete',
            },
        ])
    })

    it('should write deleteObjects operations done by a query on a single field matching multiple objects, to the ClientSyncLog in a batch write', async () => {
        let now = 2
        const { storageManager, clientSyncLog } = await setupTest({
            now: () => ++now,
        })
        await storageManager
            .collection('user')
            .createObject({ id: 53, firstName: 'John', lastName: 'Doe' })
        await storageManager
            .collection('user')
            .createObject({ id: 54, firstName: 'John', lastName: 'Paul' })
        await storageManager
            .collection('user')
            .createObject({ id: 55, firstName: 'Jess', lastName: 'Doe' })
        await storageManager
            .collection('user')
            .deleteObjects({ firstName: 'John' })
        expect(await clientSyncLog.getEntriesCreatedAfter(1)).toEqual([
            {
                deviceId: 'device-one',
                createdOn: 3,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 53,
                operation: 'create',
                value: { firstName: 'John', lastName: 'Doe' },
            },
            {
                deviceId: 'device-one',
                createdOn: 4,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 54,
                operation: 'create',
                value: { firstName: 'John', lastName: 'Paul' },
            },
            {
                deviceId: 'device-one',
                createdOn: 5,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 55,
                operation: 'create',
                value: { firstName: 'Jess', lastName: 'Doe' },
            },
            {
                deviceId: 'device-one',
                createdOn: 6,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 53,
                operation: 'delete',
            },
            {
                deviceId: 'device-one',
                createdOn: 7,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 54,
                operation: 'delete',
            },
        ])
    })

    // Skip this test as no storage backends currently implement the limit field
    it.skip('should write deleteObjects operations done by a query on a single field with a delete limit, to the ClientSyncLog in a batch write', async () => {
        let now = 2
        const { storageManager, clientSyncLog } = await setupTest({
            now: () => ++now,
        })
        await storageManager
            .collection('user')
            .createObject({ id: 53, firstName: 'John', lastName: 'Doe' })
        await storageManager
            .collection('user')
            .createObject({ id: 54, firstName: 'John', lastName: 'Paul' })
        await storageManager
            .collection('user')
            .createObject({ id: 55, firstName: 'Jess', lastName: 'Doe' })
        await storageManager
            .collection('user')
            .deleteObjects({ firstName: 'John' }, { limit: 1 })
        expect(await clientSyncLog.getEntriesCreatedAfter(1)).toEqual([
            {
                deviceId: 'device-one',
                createdOn: 3,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 53,
                operation: 'create',
                value: { firstName: 'John', lastName: 'Doe' },
            },
            {
                deviceId: 'device-one',
                createdOn: 4,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 54,
                operation: 'create',
                value: { firstName: 'John', lastName: 'Paul' },
            },
            {
                deviceId: 'device-one',
                createdOn: 5,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 55,
                operation: 'create',
                value: { firstName: 'Jess', lastName: 'Doe' },
            },
            {
                deviceId: 'device-one',
                createdOn: 6,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 53,
                operation: 'delete',
            },
        ])
    })

    it('should correctly process batch operations with deleteObjects operations', async () => {
        let now = 2
        const { storageManager, clientSyncLog } = await setupTest({
            now: () => ++now,
        })
        await storageManager
            .collection('user')
            .createObject({ id: 53, firstName: 'John', lastName: 'Doe' })
        await storageManager.operation('executeBatch', [
            {
                placeholder: 'jane',
                operation: 'deleteObjects',
                collection: 'user',
                args: { displayName: 'John Doe' },
            },
        ])
        expect(await clientSyncLog.getEntriesCreatedAfter(4)).toEqual([
            {
                deviceId: 'device-one',
                createdOn: 4,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 53,
                operation: 'delete',
            },
        ])
    })

    it('should not log anything if disabled', async () => {
        let now = 2
        const {
            storageManager,
            clientSyncLog,
            loggingMiddleware,
        } = await setupTest({
            now: () => ++now,
            deviceId: null,
        })

        await storageManager
            .collection('user')
            .createObject({ id: 53, firstName: 'John', lastName: 'Doe' })
        expect(await clientSyncLog.getEntriesCreatedAfter(0)).toEqual([])
        expect(now).toEqual(2)
    })

    it('should be able to modify operations before they get logged', async () => {
        let now = 2
        const {
            storageManager,
            clientSyncLog,
            loggingMiddleware,
        } = await setupTest({
            now: () => ++now,
        })
        loggingMiddleware.operationPreprocessor = async args => {
            const { operation } = args
            if (operation[0] === 'createObject' && operation[1] === 'user') {
                operation[2]['displayName'] += '!!!'
            }

            return args
        }

        await storageManager
            .collection('user')
            .createObject({ id: 53, displayName: 'John Doe' })
        expect(await clientSyncLog.getEntriesCreatedAfter(1)).toEqual([
            {
                deviceId: 'device-one',
                createdOn: 3,
                sharedOn: null,
                needsIntegration: false,
                collection: 'user',
                pk: 53,
                operation: 'create',
                value: { displayName: 'John Doe!!!' },
            },
        ])
    })

    it('should be able to exlude operations from being logged', async () => {
        let now = 2
        const {
            storageManager,
            clientSyncLog,
            loggingMiddleware,
        } = await setupTest({
            now: () => ++now,
        })
        loggingMiddleware.operationPreprocessor = async args => {
            const { operation } = args
            if (operation[0] === 'updateObjects' && operation[1] === 'user') {
                return { operation: null }
            }

            return args
        }

        await storageManager
            .collection('user')
            .createObject({ id: 53, displayName: 'John Doe' })
        await storageManager
            .collection('user')
            .updateObjects({ id: 53 }, { displayName: 'John' })
        expect(await clientSyncLog.getEntriesCreatedAfter(4)).toEqual([])
    })
})
