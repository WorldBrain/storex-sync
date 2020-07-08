import { CollectionDefinition } from '@worldbrain/storex'

export const HISTORY: { [name: string]: CollectionDefinition[] } = {
    clientSyncLogEntry: [
        {
            version: new Date('2019-02-05'),
            fields: {
                createdOn: { type: 'timestamp' },
                sharedOn: { type: 'timestamp', optional: true }, // when was this sent or received?
                deviceId: { type: 'json' }, // what device did this operation happen on?
                needsIntegration: { type: 'boolean', optional: true },
                collection: { type: 'string' },
                pk: { type: 'json' },
                field: { type: 'string', optional: true },
                operation: { type: 'string' },
                value: { type: 'json', optional: true },
            },
            indices: [
                { field: ['deviceId', 'createdOn'], pk: true },
                { field: 'createdOn' },
                { field: ['collection', 'pk'] },
            ],
        }
    ]
}