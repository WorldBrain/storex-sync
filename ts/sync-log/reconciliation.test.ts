import * as expect from 'expect'
import { ClientSyncLogEntry } from './types';
import { reconcileSyncLog, ExecutableOperation } from './reconciliation';

function test({logEntries, expectedOperations} : {logEntries : ClientSyncLogEntry[], expectedOperations : ExecutableOperation[]}) {
    expect(reconcileSyncLog(logEntries)).toEqual(expectedOperations)
}

describe('Reconciliation', () => {
    it('should choose the newest write when finding two entries for the same object field', () => {
        const logEntries : ClientSyncLogEntry[] = [
            {operation: 'modify', createdOn: 2, syncedOn: null, collection: 'lists', pk: 'list-one', field: 'title', value: 'second'},
            {operation: 'modify', createdOn: 1, syncedOn: null, collection: 'lists', pk: 'list-one', field: 'title', value: 'first'},
        ]

        test({logEntries, expectedOperations: [
            {operation: 'updateOneObject', collection: 'lists', args: [{pk: 'list-one'}, {title: 'second'}]}
        ]})
    })

    it('should choose the newest write when finding more than two entries for the same object field', () => {
        const logEntries : ClientSyncLogEntry[] = [
            {operation: 'modify', createdOn: 2, syncedOn: null, collection: 'lists', pk: 'list-one', field: 'title', value: 'second'},
            {operation: 'modify', createdOn: 3, syncedOn: null, collection: 'lists', pk: 'list-one', field: 'title', value: 'third'},
            {operation: 'modify', createdOn: 1, syncedOn: null, collection: 'lists', pk: 'list-one', field: 'title', value: 'first'},
        ]

        test({logEntries, expectedOperations: [
            {operation: 'updateOneObject', collection: 'lists', args: [{pk: 'list-one'}, {title: 'third'}]}
        ]})
    })

    it('should ignore writes to an object that needs deletion', () => {
        const logEntries : ClientSyncLogEntry[] = [
            {operation: 'modify', createdOn: 2, syncedOn: null, collection: 'lists', pk: 'list-one', field: 'title', value: 'second'},
            {operation: 'delete', createdOn: 1, syncedOn: null, collection: 'lists', pk: 'list-one'},
        ]

        test({logEntries, expectedOperations: [
            {operation: 'deleteOneObject', collection: 'lists', args: [{pk: 'list-one'}]}
        ]})
    })

    it('should ignore writes to an already deleted object', () => {
        const logEntries : ClientSyncLogEntry[] = [
            {operation: 'modify', createdOn: 2, syncedOn: null, collection: 'lists', pk: 'list-one', field: 'title', value: 'second'},
            {operation: 'delete', createdOn: 4, syncedOn: 3, collection: 'lists', pk: 'list-one'},
            {operation: 'delete', createdOn: 1, syncedOn: 3, collection: 'lists', pk: 'list-one'},
        ]

        test({logEntries, expectedOperations: []})
    })

    it('should work with only one delete', () => {
        const logEntries : ClientSyncLogEntry[] = [
            {operation: 'delete', createdOn: 1, syncedOn: null, collection: 'lists', pk: 'list-one'},
        ]

        test({logEntries, expectedOperations:  [
            {operation: 'deleteOneObject', collection: 'lists', args: [{pk: 'list-one'}]}
        ]})
    })

    it('should ignore double deletes', () => {
        const logEntries : ClientSyncLogEntry[] = [
            {operation: 'delete', createdOn: 4, syncedOn: null, collection: 'lists', pk: 'list-one'},
            {operation: 'delete', createdOn: 1, syncedOn: null, collection: 'lists', pk: 'list-one'},
        ]

        test({logEntries, expectedOperations: [
            {operation: 'deleteOneObject', collection: 'lists', args: [{pk: 'list-one'}]}
        ]})
    })

    it('should work with compound keys')
})