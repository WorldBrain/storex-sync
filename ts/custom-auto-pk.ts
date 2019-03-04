import { StorageMiddleware } from "@worldbrain/storex/lib/types/middleware"
import { StorageRegistry } from "@worldbrain/storex"
import { dissectCreateObjectOperation, convertCreateObjectDissectionToBatch, reconstructCreatedObjectFromBatchResult } from "@worldbrain/storex/lib/utils";

export type CustomPkGenerator = () => string

export class CustomAutoPkMiddleware implements StorageMiddleware {
    private _collections : {[name : string]: {pkIndex : string}}
    private _pkGenerator : CustomPkGenerator
    private _storageRegistry : StorageRegistry

    constructor({pkGenerator} : {pkGenerator : CustomPkGenerator}) {
        this._pkGenerator = pkGenerator
    }

    setup({ storageRegistry, collections } : { storageRegistry : StorageRegistry, collections : string[] }) {
        this._storageRegistry = storageRegistry
        this._collections = {}
        for (const collection of collections) {
            const collectionDefinition = storageRegistry.collections[collection]
            const pkIndex = collectionDefinition.pkIndex as string
            collectionDefinition.fields[pkIndex].type = 'string'
            this._collections[collection] = {pkIndex}
        }
    }

    async process({ next, operation }: { next: { process: ({ operation }: { operation: any; }) => any; }; operation: any[]; }) {
        const mainCollection = operation[1]
        if (operation[0] !== 'createObject' || !this._collections[mainCollection]) {
            return next.process({operation})
        }

        const object = operation[2]
        const operationDissection = dissectCreateObjectOperation({
            collection: mainCollection,
            args: object
        }, this._storageRegistry)
        const batch = convertCreateObjectDissectionToBatch(operationDissection)
        for (const batchElement of batch) {
            const collectionInfo = this._collections[batchElement.collection]
            if (!collectionInfo) {
                continue
            }

            batchElement.args[collectionInfo.pkIndex] = this._pkGenerator()
        }

        const batchResult = await next.process({ operation: ['executeBatch', batch] })
        reconstructCreatedObjectFromBatchResult({
            object, collection: mainCollection, storageRegistry: this._storageRegistry,
            operationDissection, batchResultInfo: batchResult.info
        })
        return { object }
    }
}
