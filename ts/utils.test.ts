import expect from 'expect'
import StorageManager, { CollectionDefinitionMap } from '@worldbrain/storex';
import { getObjectPk, getObjectWithoutPk, setObjectPk } from './utils';

describe('Primary key utils', () => {
    async function setupTest(config : {collections : CollectionDefinitionMap}) {
        const backend = {
            configure: () => null,
            operation: async (...args : any[]) => ({args})
        } as any
        const storageManager = new StorageManager({backend})
        storageManager.registry.registerCollections(config.collections)
        return { storageManager }
    }

    describe('getObjectPk()', () => {
        it('should work for an object with a single field pk', async () => {
            const { storageManager } = await setupTest({collections: {
                user: {
                    version: new Date('2019-02-19'),
                    fields: {
                        displayName: {type: 'string'}
                    }
                }
            }})
            expect(getObjectPk({id: 1, displayName: 'Joe'}, 'user', storageManager.registry)).toEqual(1)
        })

        it('should work for an object with a compound pk', async () => {
            const { storageManager } = await setupTest({collections: {
                user: {
                    version: new Date('2019-02-19'),
                    fields: {
                        firstName: {type: 'string'},
                        lastName: {type: 'string'},
                        email: {type: 'string'}
                    },
                    pkIndex: ['firstName', 'lastName']
                }
            }})
            expect(getObjectPk({firstName: 'Joe', lastName: 'Doe', email: 'bla@bla.com'}, 'user', storageManager.registry)).toEqual(['Joe', 'Doe'])
        })
    })

    describe('getObjectWithoutPk()', () => {
        it('should work for an object with a single field pk', async () => {
            const { storageManager } = await setupTest({collections: {
                user: {
                    version: new Date('2019-02-19'),
                    fields: {
                        displayName: {type: 'string'}
                    }
                }
            }})
            expect(getObjectWithoutPk({id: 1, displayName: 'Joe'}, 'user', storageManager.registry)).toEqual({displayName: 'Joe'})
        })

        it('should work for an object with a compound pk', async () => {
            const { storageManager } = await setupTest({collections: {
                user: {
                    version: new Date('2019-02-19'),
                    fields: {
                        firstName: {type: 'string'},
                        lastName: {type: 'string'},
                        email: {type: 'string'}
                    },
                    pkIndex: ['firstName', 'lastName']
                }
            }})
            expect(getObjectWithoutPk({firstName: 'Joe', lastName: 'Doe', email: 'bla@bla.com'}, 'user', storageManager.registry)).toEqual({email: 'bla@bla.com'})
        })
    })

    describe('setObjectPk()', () => {
        it('should work for an object with a single field pk', async () => {
            const { storageManager } = await setupTest({collections: {
                user: {
                    version: new Date('2019-02-19'),
                    fields: {
                        displayName: {type: 'string'}
                    }
                }
            }})

            const object = {displayName: 'Joe'}
            const returned = setObjectPk(object, 2, 'user', storageManager.registry)
            expect(object).toEqual({id: 2, displayName: 'Joe'})
            expect(returned).toEqual(object)
        })

        it('should work for an object with a compound pk', async () => {
            const { storageManager } = await setupTest({collections: {
                user: {
                    version: new Date('2019-02-19'),
                    fields: {
                        firstName: {type: 'string'},
                        lastName: {type: 'string'},
                        email: {type: 'string'}
                    },
                    pkIndex: ['firstName', 'lastName']
                }
            }})

            const object = {email: 'joe@doe.com'}
            const returned = setObjectPk(object, ['Joe', 'Doe'], 'user', storageManager.registry)
            expect(object).toEqual({firstName: 'Joe', lastName: 'Doe', email: 'joe@doe.com'})
            expect(returned).toEqual(object)
        })
    })
})