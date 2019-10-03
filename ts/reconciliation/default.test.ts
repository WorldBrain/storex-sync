import { StorageRegistry, OperationBatch } from '@worldbrain/storex'
import expect from 'expect'
import { ClientSyncLogEntry } from '../client-sync-log/types'
import { reconcileSyncLog } from './default'

function test({
    logEntries,
    expectedOperations,
}: {
    logEntries: ClientSyncLogEntry[]
    expectedOperations?: OperationBatch
}) {
    const storageRegistry = new StorageRegistry()
    storageRegistry.registerCollections({
        list: {
            version: new Date('2019-02-02'),
            fields: {
                title: { type: 'string' },
            },
        },
        listEntry: {
            version: new Date('2019-02-02'),
            fields: {
                title: { type: 'string' },
                url: { type: 'string' },
            },
        },
        pageBookmark: {
            version: new Date('2019-02-02'),
            fields: {
                url: { type: 'string' },
                time: { type: 'timestamp' },
            },
            indices: [{ field: 'url', pk: true }],
        },
    })

    const reconciled = reconcileSyncLog(logEntries, { storageRegistry })
    if (expectedOperations) {
        expect(reconciled).toEqual(expectedOperations)
    }
}

describe('Reconciliation', () => {
    it('should integrate field updates', () => {
        const logEntries: ClientSyncLogEntry[] = [
            {
                id: 1,
                createdOn: 2,
                sharedOn: 525252,
                needsIntegration: true,
                collection: 'list',
                pk: 'list-id',
                field: 'title',
                operation: 'modify',
                value: 'Updated List Title',
            },
        ]

        test({
            logEntries,
            expectedOperations: [
                {
                    operation: 'updateObjects',
                    collection: 'list',
                    where: { id: 'list-id' },
                    updates: { title: 'Updated List Title' },
                },
            ],
        })
    })

    it('should choose the newest write when finding two entries for the same object field', () => {
        const logEntries: ClientSyncLogEntry[] = [
            {
                operation: 'modify',
                createdOn: 2,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'list',
                pk: 'list-one',
                field: 'title',
                value: 'second',
            },
            {
                operation: 'modify',
                createdOn: 1,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'list',
                pk: 'list-one',
                field: 'title',
                value: 'first',
            },
        ]

        test({
            logEntries,
            expectedOperations: [
                {
                    operation: 'updateObjects',
                    collection: 'list',
                    where: { id: 'list-one' },
                    updates: { title: 'second' },
                },
            ],
        })
    })

    it('should choose the newest write when finding more than two entries for the same object field', () => {
        const logEntries: ClientSyncLogEntry[] = [
            {
                operation: 'modify',
                createdOn: 2,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'list',
                pk: 'list-one',
                field: 'title',
                value: 'second',
            },
            {
                operation: 'modify',
                createdOn: 3,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'list',
                pk: 'list-one',
                field: 'title',
                value: 'third',
            },
            {
                operation: 'modify',
                createdOn: 1,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'list',
                pk: 'list-one',
                field: 'title',
                value: 'first',
            },
        ]

        test({
            logEntries,
            expectedOperations: [
                {
                    operation: 'updateObjects',
                    collection: 'list',
                    where: { id: 'list-one' },
                    updates: { title: 'third' },
                },
            ],
        })
    })

    it('should ignore writes to an object that needs deletion', () => {
        const logEntries: ClientSyncLogEntry[] = [
            {
                operation: 'modify',
                createdOn: 2,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'list',
                pk: 'list-one',
                field: 'title',
                value: 'second',
            },
            {
                operation: 'delete',
                createdOn: 1,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'list',
                pk: 'list-one',
            },
        ]

        test({
            logEntries,
            expectedOperations: [
                {
                    operation: 'deleteObjects',
                    collection: 'list',
                    where: { id: 'list-one' },
                },
            ],
        })
    })

    it('should ignore writes to an already deleted object', () => {
        const logEntries: ClientSyncLogEntry[] = [
            {
                operation: 'modify',
                createdOn: 2,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'list',
                pk: 'list-one',
                field: 'title',
                value: 'second',
            },
            {
                operation: 'delete',
                createdOn: 4,
                sharedOn: 3,
                needsIntegration: true,
                collection: 'list',
                pk: 'list-one',
            },
            {
                operation: 'delete',
                createdOn: 1,
                sharedOn: 3,
                needsIntegration: true,
                collection: 'list',
                pk: 'list-one',
            },
        ]

        test({
            logEntries,
            expectedOperations: [
                {
                    collection: 'list',
                    operation: 'deleteObjects',
                    where: {
                        id: 'list-one',
                    },
                },
            ],
        })
    })

    it('should work with only one delete', () => {
        const logEntries: ClientSyncLogEntry[] = [
            {
                operation: 'delete',
                createdOn: 1,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'list',
                pk: 'list-one',
            },
        ]

        test({
            logEntries,
            expectedOperations: [
                {
                    operation: 'deleteObjects',
                    collection: 'list',
                    where: { id: 'list-one' },
                },
            ],
        })
    })

    it('should ignore double deletes', () => {
        const logEntries: ClientSyncLogEntry[] = [
            {
                operation: 'delete',
                createdOn: 4,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'list',
                pk: 'list-one',
            },
            {
                operation: 'delete',
                createdOn: 1,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'list',
                pk: 'list-one',
            },
        ]

        test({
            logEntries,
            expectedOperations: [
                {
                    operation: 'deleteObjects',
                    collection: 'list',
                    where: { id: 'list-one' },
                },
            ],
        })
    })

    it('should work with deletes having compound keys', () => {
        const logEntries: ClientSyncLogEntry[] = [
            {
                operation: 'delete',
                createdOn: 4,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'listEntry',
                pk: ['list-one', 3],
            },
        ]

        test({
            logEntries,
            expectedOperations: [
                {
                    operation: 'deleteObjects',
                    collection: 'listEntry',
                    where: { id: ['list-one', 3] },
                },
            ],
        })
    })

    // it('should ignore writes that are already synced', () => {
    //     const logEntries: ClientSyncLogEntry[] = [
    //         {
    //             operation: 'modify',
    //             createdOn: 1,
    //             sharedOn: 52525252,
    //             needsIntegration: true,
    //             collection: 'list',
    //             pk: 'list-one',
    //             field: 'title',
    //             value: 'second',
    //         },
    //         {
    //             operation: 'modify',
    //             createdOn: 2,
    //             sharedOn: 3,
    //             needsIntegration: true,
    //             collection: 'list',
    //             pk: 'list-one',
    //             field: 'title',
    //             value: 'second',
    //         },
    //     ]

    //     test({ logEntries, expectedOperations: [] })
    // })

    it('should create objects', () => {
        const logEntries: ClientSyncLogEntry[] = [
            {
                operation: 'create',
                createdOn: 1,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'list',
                pk: 'list-one',
                value: { title: 'first' },
            },
        ]

        test({
            logEntries,
            expectedOperations: [
                {
                    operation: 'createObject',
                    collection: 'list',
                    args: { id: 'list-one', title: 'first' },
                },
            ],
        })
    })

    it('should consolidate object creation with object updates', () => {
        const logEntries: ClientSyncLogEntry[] = [
            {
                operation: 'modify',
                createdOn: 2,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'list',
                pk: 'list-one',
                field: 'title',
                value: 'second',
            },
            {
                operation: 'create',
                createdOn: 1,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'list',
                pk: 'list-one',
                value: { title: 'first', prio: 5 },
            },
        ]

        test({
            logEntries,
            expectedOperations: [
                {
                    operation: 'createObject',
                    collection: 'list',
                    args: { id: 'list-one', title: 'second', prio: 5 },
                },
            ],
        })
    })

    it('should consolidate object creation with object deletion', () => {
        const logEntries: ClientSyncLogEntry[] = [
            {
                operation: 'modify',
                createdOn: 2,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'list',
                pk: 'list-one',
                field: 'title',
                value: 'second',
            },
            {
                operation: 'create',
                createdOn: 1,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'list',
                pk: 'list-one',
                value: { pk: 'list-one', title: 'first', prio: 5 },
            },
            {
                operation: 'delete',
                createdOn: 3,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'list',
                pk: 'list-one',
            },
        ]

        test({ logEntries, expectedOperations: [] })
    })

    it('should correctly recreate an object after deletion', () => {
        const logEntries: ClientSyncLogEntry[] = [
            {
                operation: 'create',
                createdOn: 2,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'pageBookmark',
                pk: 'bookmark-one',
                value: { url: 'bookmark-one', time: 2 },
            },
            {
                operation: 'delete',
                createdOn: 3,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'pageBookmark',
                pk: 'bookmark-one',
            },
            {
                operation: 'create',
                createdOn: 2,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'pageBookmark',
                pk: 'bookmark-one',
                value: { url: 'bookmark-one', time: 4 },
            },
        ]

        test({
            logEntries,
            expectedOperations: [
                {
                    operation: 'createObject',
                    collection: 'pageBookmark',
                    args: { url: 'bookmark-one', time: 4 },
                },
            ],
        })
    })

    it('should correctly recreate an object after deletion without creation', () => {
        const logEntries: ClientSyncLogEntry[] = [
            {
                operation: 'delete',
                createdOn: 3,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'pageBookmark',
                pk: 'bookmark-one',
            },
            {
                operation: 'create',
                createdOn: 2,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'pageBookmark',
                pk: 'bookmark-one',
                value: { url: 'bookmark-one', time: 4 },
            },
        ]

        test({
            logEntries,
            expectedOperations: [
                {
                    operation: 'createObject',
                    collection: 'pageBookmark',
                    args: { url: 'bookmark-one', time: 4 },
                },
            ],
        })
    })

    it('should complain about double creates', () => {
        const logEntries: ClientSyncLogEntry[] = [
            {
                operation: 'create',
                createdOn: 1,
                sharedOn: 1,
                needsIntegration: true,
                collection: 'list',
                pk: 'list-one',
                value: { pk: 'list-one', title: 'first', prio: 5 },
            },
            {
                operation: 'create',
                createdOn: 2,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'list',
                pk: 'list-one',
                value: { pk: 'list-one', title: 'first', prio: 5 },
            },
        ]

        expect(() => test({ logEntries })).toThrow(
            `Detected double create in collection 'list', pk '"list-one"'`,
        )
    })

    it('should complain about modifications made to an object before creation', () => {
        const logEntries: ClientSyncLogEntry[] = [
            {
                operation: 'modify',
                createdOn: 1,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'list',
                pk: 'list-one',
                field: 'title',
                value: 'second',
            },
            {
                operation: 'create',
                createdOn: 2,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'list',
                pk: 'list-one',
                value: { pk: 'list-one', title: 'first', prio: 5 },
            },
        ]

        expect(() => test({ logEntries })).toThrow(
            `Detected modification to collection 'list', pk '"list-one"' before it was created (likely pk collision)`,
        )
    })

    it('should complain about modifications made to an object before creation even if received in the right order', () => {
        const logEntries: ClientSyncLogEntry[] = [
            {
                operation: 'create',
                createdOn: 2,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'list',
                pk: 'list-one',
                value: { pk: 'list-one', title: 'first', prio: 5 },
            },
            {
                operation: 'modify',
                createdOn: 1,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'list',
                pk: 'list-one',
                field: 'title',
                value: 'second',
            },
        ]

        expect(() => test({ logEntries })).toThrow(
            `Detected modification to collection 'list', pk '"list-one"' before it was created (likely pk collision)`,
        )
    })
})
