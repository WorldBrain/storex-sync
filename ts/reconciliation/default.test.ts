import { StorageRegistry, OperationBatch } from '@worldbrain/storex'
import expect from 'expect'
import { ClientSyncLogEntry } from '../client-sync-log/types'
import { reconcileSyncLog } from './default'

function test({
    logEntries,
    expectedOperations,
    debug,
}: {
    logEntries: ClientSyncLogEntry[]
    expectedOperations?: OperationBatch
    debug?: boolean
}) {
    const storageRegistry = new StorageRegistry()
    storageRegistry.registerCollections({
        customList: {
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
    })

    const reconciled = reconcileSyncLog(logEntries, { storageRegistry, debug })
    if (expectedOperations) {
        expect(reconciled).toEqual(expectedOperations)
    }
}

type Event =
    | 'creation'
    | 'modification'
    | 'deletion'
    | 'recreation'
    | 'redeletion'
const EVENTS = new Set<Event>([
    'creation',
    'modification',
    'deletion',
    'recreation',
    'redeletion',
])
const TEST_FLOWS: Array<Event[]> = [
    ['creation'],
    ['creation', 'modification'],
    ['creation', 'modification', 'deletion'],
    ['creation', 'modification', 'modification', 'deletion'],
    ['modification', 'modification'],
    ['creation', 'deletion', 'recreation'],
    ['deletion', 'recreation', 'redeletion'],
    ['deletion', 'modification'],
]

const ACTION_ENTRIES: {
    [key in Event]: ClientSyncLogEntry
} = {
    creation: {
        operation: 'create',
        createdOn: 1,
        sharedOn: 52525252,
        needsIntegration: false,
        collection: 'customList',
        pk: 'list-one',
        value: { id: 'list-one', title: 'List one' },
    },
    modification: {
        id: 1,
        createdOn: 2,
        sharedOn: 525252,
        needsIntegration: true,
        collection: 'customList',
        pk: 'list-one',
        field: 'title',
        operation: 'modify',
        value: 'List (updated)',
    },
    deletion: {
        operation: 'delete',
        createdOn: 1,
        sharedOn: 52525252,
        needsIntegration: false,
        collection: 'customList',
        pk: 'list-one',
    },
    recreation: {
        operation: 'create',
        createdOn: 1,
        sharedOn: 52525252,
        needsIntegration: false,
        collection: 'customList',
        pk: 'list-one',
        value: { title: 'List one recreated' },
    },
    redeletion: {
        operation: 'delete',
        createdOn: 1,
        sharedOn: 52525252,
        needsIntegration: false,
        collection: 'customList',
        pk: 'list-one',
    },
}

interface SyncTestContext {
    entry: (
        type: Event,
        options: { needsIntegration: boolean; value?: any },
    ) => ClientSyncLogEntry
}
interface SyncFlowTestInfo {
    flow: Event[]
    scenarios: Array<SyncFlowScenarioTestInfo>
}
interface SyncFlowScenarioTestInfo {
    steps: Array<{ type: Event; needsIntegration: boolean }>
}
class TestCreator {
    tested: Array<SyncFlowTestInfo> = []

    suite(
        flow: Event[],
        suite: (suiteContext: {
            scenario: (
                description: string,
                test: (testContext: SyncTestContext) => void,
            ) => void
        }) => void,
    ) {
        describe('should correctly handle ' + flow.join(', '), () => {
            const flowInfo: SyncFlowTestInfo = { flow, scenarios: [] }
            this.tested.push(flowInfo)

            suite({
                scenario: (
                    description: string,
                    scenario: (context: SyncTestContext) => void,
                ) => {
                    const scenarioInfo: SyncFlowScenarioTestInfo = { steps: [] }
                    flowInfo.scenarios.push(scenarioInfo)

                    it(description, () => {
                        let now = 1
                        scenario({
                            entry: (
                                type: Event,
                                options: {
                                    needsIntegration: boolean
                                    value?: any
                                },
                            ) => {
                                scenarioInfo.steps.push({
                                    type: type as Event,
                                    needsIntegration: options.needsIntegration,
                                })
                                return {
                                    ...ACTION_ENTRIES[type],
                                    ...options,
                                    createdOn: ++now,
                                }
                            },
                        })
                    })
                },
            })
        })
    }
}

describe('Reconciliation', () => {
    const TEST_CREATOR = new TestCreator()

    if (process.env.SKIP_SYNC_FLOW_CHECKS !== 'true') {
        after('we should have tested all necessary flows', () => {
            const testedFlows = new Set(
                TEST_CREATOR.tested.map(scenarioInfo =>
                    scenarioInfo.flow.join(', '),
                ),
            )
            const requiredFlows = new Set(
                TEST_FLOWS.map(flow => flow.join(', ')),
            )
            const missingFlows = new Set(
                [...requiredFlows].filter(flow => !testedFlows.has(flow)),
            )
            expect({ missingFlows }).toEqual({ missingFlows: new Set() })

            for (const testedFlow of TEST_CREATOR.tested) {
                const expected: SyncFlowTestInfo = {
                    flow: testedFlow.flow,
                    scenarios: [],
                }
                for (
                    let scenarioIndex = 1;
                    scenarioIndex <= testedFlow.flow.length;
                    ++scenarioIndex
                ) {
                    const scenario: SyncFlowScenarioTestInfo = { steps: [] }
                    expected.scenarios.push(scenario)

                    for (
                        let stepIndex = 0;
                        stepIndex < testedFlow.flow.length;
                        ++stepIndex
                    ) {
                        scenario.steps.unshift(
                            (expect as any).objectContaining({
                                needsIntegration: stepIndex < scenarioIndex,
                            } as any),
                        )
                    }
                }
                expect(testedFlow).toEqual(expected)
            }
        })
    }

    TEST_CREATOR.suite(['creation'], ({ scenario }) => {
        scenario('with all entries needing integration', ({ entry }) => {
            test({
                logEntries: [entry('creation', { needsIntegration: true })],
                expectedOperations: [
                    {
                        operation: 'createObject',
                        collection: 'customList',
                        args: { id: 'list-one', title: 'List one' },
                    },
                ],
            })
        })
    })

    TEST_CREATOR.suite(['modification', 'modification'], ({ scenario }) => {
        scenario(
            'with only the second update needing integration',
            ({ entry }) => {
                test({
                    logEntries: [
                        entry('modification', {
                            needsIntegration: false,
                            value: 'First title update',
                        }),
                        entry('modification', {
                            needsIntegration: true,
                            value: 'Second title update',
                        }),
                    ],
                    expectedOperations: [
                        {
                            operation: 'updateObjects',
                            collection: 'customList',
                            where: { id: 'list-one' },
                            updates: { title: 'Second title update' },
                        },
                    ],
                })
            },
        )

        scenario('with all entries needing integration', ({ entry }) => {
            test({
                logEntries: [
                    entry('modification', {
                        needsIntegration: true,
                        value: 'First title update',
                    }),
                    entry('modification', {
                        needsIntegration: true,
                        value: 'Second title update',
                    }),
                ],
                expectedOperations: [
                    {
                        operation: 'updateObjects',
                        collection: 'customList',
                        where: { id: 'list-one' },
                        updates: { title: 'Second title update' },
                    },
                ],
            })
        })
    })

    TEST_CREATOR.suite(
        ['creation', 'modification', 'deletion'],
        ({ scenario }) => {
            scenario('with only deletion needing integration', ({ entry }) => {
                test({
                    logEntries: [
                        entry('creation', { needsIntegration: false }),
                        entry('modification', { needsIntegration: false }),
                        entry('deletion', { needsIntegration: true }),
                    ],
                    expectedOperations: [
                        {
                            operation: 'deleteObjects',
                            collection: 'customList',
                            where: { id: 'list-one' },
                        },
                    ],
                })
            })

            scenario(
                'with only modification and deletion needing integration',
                ({ entry }) => {
                    test({
                        logEntries: [
                            entry('creation', { needsIntegration: false }),
                            entry('modification', { needsIntegration: true }),
                            entry('deletion', { needsIntegration: true }),
                        ],
                        expectedOperations: [
                            {
                                operation: 'deleteObjects',
                                collection: 'customList',
                                where: { id: 'list-one' },
                            },
                        ],
                    })
                },
            )

            scenario('with all entries needing integration', ({ entry }) => {
                test({
                    logEntries: [
                        entry('creation', { needsIntegration: true }),
                        entry('modification', { needsIntegration: true }),
                        entry('deletion', { needsIntegration: true }),
                    ],
                    expectedOperations: [],
                })
            })
        },
    )

    TEST_CREATOR.suite(
        ['creation', 'modification', 'modification', 'deletion'],
        ({ scenario }) => {
            scenario('with only deletion needing integration', ({ entry }) => {
                test({
                    logEntries: [
                        entry('creation', { needsIntegration: false }),
                        entry('modification', {
                            needsIntegration: false,
                            value: 'first',
                        }),
                        entry('modification', {
                            needsIntegration: false,
                            value: 'second',
                        }),
                        entry('deletion', { needsIntegration: true }),
                    ],
                    expectedOperations: [
                        {
                            operation: 'deleteObjects',
                            collection: 'customList',
                            where: { id: 'list-one' },
                        },
                    ],
                })
            })

            scenario(
                'with only the second modification and deletion needing integration',
                ({ entry }) => {
                    test({
                        logEntries: [
                            entry('creation', { needsIntegration: false }),
                            entry('modification', {
                                needsIntegration: false,
                                value: 'first',
                            }),
                            entry('modification', {
                                needsIntegration: true,
                                value: 'second',
                            }),
                            entry('deletion', { needsIntegration: true }),
                        ],
                        expectedOperations: [
                            {
                                operation: 'deleteObjects',
                                collection: 'customList',
                                where: { id: 'list-one' },
                            },
                        ],
                    })
                },
            )

            scenario(
                'with only the second modification and deletion needing integration',
                ({ entry }) => {
                    test({
                        logEntries: [
                            entry('creation', { needsIntegration: false }),
                            entry('modification', {
                                needsIntegration: true,
                                value: 'first',
                            }),
                            entry('modification', {
                                needsIntegration: true,
                                value: 'second',
                            }),
                            entry('deletion', { needsIntegration: true }),
                        ],
                        expectedOperations: [
                            {
                                operation: 'deleteObjects',
                                collection: 'customList',
                                where: { id: 'list-one' },
                            },
                        ],
                    })
                },
            )

            scenario('with all entries needing integration', ({ entry }) => {
                test({
                    logEntries: [
                        entry('creation', { needsIntegration: true }),
                        entry('modification', {
                            needsIntegration: true,
                            value: 'first',
                        }),
                        entry('modification', {
                            needsIntegration: true,
                            value: 'second',
                        }),
                        entry('deletion', { needsIntegration: true }),
                    ],
                    expectedOperations: [],
                })
            })
        },
    )

    it('should choose the newest write when finding two entries for the same object field', () => {
        const logEntries: ClientSyncLogEntry[] = [
            {
                operation: 'modify',
                createdOn: 2,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'customList',
                pk: 'list-one',
                field: 'title',
                value: 'second',
            },
            {
                operation: 'modify',
                createdOn: 1,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'customList',
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
                    collection: 'customList',
                    where: { id: 'list-one' },
                    updates: { title: 'second' },
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
                collection: 'customList',
                pk: 'list-one',
                field: 'title',
                value: 'second',
            },
            {
                operation: 'delete',
                createdOn: 1,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'customList',
                pk: 'list-one',
            },
        ]

        test({
            logEntries,
            expectedOperations: [
                {
                    operation: 'deleteObjects',
                    collection: 'customList',
                    where: { id: 'list-one' },
                },
            ],
        })
    })

    it('should ignore writes to an already deleted object', () => {
        const logEntries: ClientSyncLogEntry[] = [
            {
                operation: 'delete',
                createdOn: 1,
                sharedOn: 3,
                needsIntegration: true,
                collection: 'customList',
                pk: 'list-one',
            },
            {
                operation: 'modify',
                createdOn: 2,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'customList',
                pk: 'list-one',
                field: 'title',
                value: 'second',
            },
            {
                operation: 'delete',
                createdOn: 4,
                sharedOn: 3,
                needsIntegration: true,
                collection: 'customList',
                pk: 'list-one',
            },
        ]

        test({
            logEntries,
            expectedOperations: [
                {
                    collection: 'customList',
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
                collection: 'customList',
                pk: 'list-one',
            },
        ]

        test({
            logEntries,
            expectedOperations: [
                {
                    operation: 'deleteObjects',
                    collection: 'customList',
                    where: { id: 'list-one' },
                },
            ],
        })
    })

    it('should ignore double deletes', () => {
        const logEntries: ClientSyncLogEntry[] = [
            {
                operation: 'delete',
                createdOn: 1,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'customList',
                pk: 'list-one',
            },
            {
                operation: 'delete',
                createdOn: 4,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'customList',
                pk: 'list-one',
            },
        ]

        test({
            logEntries,
            expectedOperations: [
                {
                    operation: 'deleteObjects',
                    collection: 'customList',
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

    TEST_CREATOR.suite(['creation', 'modification'], ({ scenario }) => {
        scenario('with only modification needing integration', ({ entry }) => {
            test({
                logEntries: [
                    entry('creation', { needsIntegration: false }),
                    entry('modification', { needsIntegration: true }),
                ],
                expectedOperations: [
                    {
                        operation: 'updateObjects',
                        collection: 'customList',
                        where: { id: 'list-one' },
                        updates: { title: 'List (updated)' },
                    },
                ],
            })
        })

        scenario('with all entries needing integration', ({ entry }) => {
            test({
                logEntries: [
                    entry('creation', { needsIntegration: true }),
                    entry('modification', { needsIntegration: true }),
                ],
                expectedOperations: [
                    {
                        operation: 'createObject',
                        collection: 'customList',
                        args: { id: 'list-one', title: 'List (updated)' },
                    },
                ],
            })
        })
    })

    it('should consolidate object creation with object deletion', () => {
        const logEntries: ClientSyncLogEntry[] = [
            {
                operation: 'modify',
                createdOn: 2,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'customList',
                pk: 'list-one',
                field: 'title',
                value: 'second',
            },
            {
                operation: 'create',
                createdOn: 1,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'customList',
                pk: 'list-one',
                value: { pk: 'list-one', title: 'first', prio: 5 },
            },
            {
                operation: 'delete',
                createdOn: 3,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'customList',
                pk: 'list-one',
            },
        ]

        test({ logEntries, expectedOperations: [] })
    })

    TEST_CREATOR.suite(
        ['creation', 'deletion', 'recreation'],
        ({ scenario }) => {
            scenario(
                'with only recreation needing integration',
                ({ entry }) => {
                    test({
                        logEntries: [
                            entry('creation', { needsIntegration: false }),
                            entry('deletion', { needsIntegration: false }),
                            entry('recreation', { needsIntegration: true }),
                        ],
                        expectedOperations: [
                            {
                                operation: 'createObject',
                                collection: 'customList',
                                args: {
                                    id: 'list-one',
                                    title: 'List one recreated',
                                },
                            },
                        ],
                    })
                },
            )

            scenario(
                'with only deletion and recreation needing integration',
                ({ entry }) => {
                    test({
                        logEntries: [
                            entry('creation', { needsIntegration: false }),
                            entry('deletion', { needsIntegration: true }),
                            entry('recreation', { needsIntegration: true }),
                        ],
                        expectedOperations: [
                            {
                                operation: 'deleteObjects',
                                collection: 'customList',
                                where: { id: 'list-one' },
                            },
                            {
                                operation: 'createObject',
                                collection: 'customList',
                                args: {
                                    id: 'list-one',
                                    title: 'List one recreated',
                                },
                            },
                        ],
                    })
                },
            )

            scenario('all entries needing integration', ({ entry }) => {
                test({
                    logEntries: [
                        entry('creation', { needsIntegration: true }),
                        entry('deletion', { needsIntegration: true }),
                        entry('recreation', { needsIntegration: true }),
                    ],
                    expectedOperations: [
                        {
                            operation: 'createObject',
                            collection: 'customList',
                            args: {
                                id: 'list-one',
                                title: 'List one recreated',
                            },
                        },
                    ],
                })
            })
        },
    )

    TEST_CREATOR.suite(
        ['deletion', 'recreation', 'redeletion'],
        ({ scenario }) => {
            scenario('with only redelete needing integration', ({ entry }) => {
                test({
                    logEntries: [
                        entry('deletion', { needsIntegration: false }),
                        entry('recreation', { needsIntegration: false }),
                        entry('redeletion', { needsIntegration: true }),
                    ],
                    expectedOperations: [
                        {
                            operation: 'deleteObjects',
                            collection: 'customList',
                            where: { id: 'list-one' },
                        },
                    ],
                })
            })

            scenario(
                'with only recreation and redelete needing integration',
                ({ entry }) => {
                    test({
                        logEntries: [
                            entry('deletion', { needsIntegration: false }),
                            entry('recreation', { needsIntegration: true }),
                            entry('redeletion', { needsIntegration: true }),
                        ],
                        expectedOperations: [],
                    })
                },
            )

            scenario('with all entries needing integration', ({ entry }) => {
                test({
                    logEntries: [
                        entry('deletion', { needsIntegration: true }),
                        entry('recreation', { needsIntegration: true }),
                        entry('redeletion', { needsIntegration: true }),
                    ],
                    expectedOperations: [
                        {
                            operation: 'deleteObjects',
                            collection: 'customList',
                            where: { id: 'list-one' },
                        },
                    ],
                })
            })
        },
    )

    TEST_CREATOR.suite(['deletion', 'modification'], ({ scenario }) => {
        scenario('with only modification needing integration', ({ entry }) => {
            test({
                logEntries: [
                    entry('deletion', { needsIntegration: false }),
                    entry('modification', { needsIntegration: true }),
                ],
                expectedOperations: [],
            })
        })

        scenario('with all entries needing integration', ({ entry }) => {
            test({
                logEntries: [
                    entry('deletion', { needsIntegration: true }),
                    entry('modification', { needsIntegration: true }),
                ],
                expectedOperations: [
                    {
                        operation: 'deleteObjects',
                        collection: 'customList',
                        where: { id: 'list-one' },
                    },
                ],
            })
        })
    })

    it('should correctly recreate an object after deletion without creation', () => {
        const logEntries: ClientSyncLogEntry[] = [
            {
                operation: 'delete',
                createdOn: 2,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'customList',
                pk: 'list-one',
            },
            {
                operation: 'create',
                createdOn: 3,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'customList',
                pk: 'list-one',
                value: { title: 'List one' },
            },
        ]

        test({
            logEntries,
            expectedOperations: [
                {
                    operation: 'deleteObjects',
                    collection: 'customList',
                    where: { id: 'list-one' },
                },
                {
                    operation: 'createObject',
                    collection: 'customList',
                    args: { id: 'list-one', title: 'List one' },
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
                collection: 'customList',
                pk: 'list-one',
                value: { pk: 'list-one', title: 'first', prio: 5 },
            },
            {
                operation: 'create',
                createdOn: 2,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'customList',
                pk: 'list-one',
                value: { pk: 'list-one', title: 'first', prio: 5 },
            },
        ]

        expect(() => test({ logEntries })).toThrow(
            `Detected double create in collection 'customList', pk '"list-one"'`,
        )
    })

    it('should complain about modifications made to an object before creation', () => {
        const logEntries: ClientSyncLogEntry[] = [
            {
                operation: 'modify',
                createdOn: 1,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'customList',
                pk: 'list-one',
                field: 'title',
                value: 'second',
            },
            {
                operation: 'create',
                createdOn: 2,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'customList',
                pk: 'list-one',
                value: { pk: 'list-one', title: 'first', prio: 5 },
            },
        ]

        expect(() => test({ logEntries })).toThrow(
            `Detected modification to collection 'customList', pk '"list-one"' before it was created (likely pk collision)`,
        )
    })

    it('should complain about modifications made to an object before creation even if received in the right order', () => {
        const logEntries: ClientSyncLogEntry[] = [
            {
                operation: 'create',
                createdOn: 2,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'customList',
                pk: 'list-one',
                value: { pk: 'list-one', title: 'first', prio: 5 },
            },
            {
                operation: 'modify',
                createdOn: 1,
                sharedOn: 52525252,
                needsIntegration: true,
                collection: 'customList',
                pk: 'list-one',
                field: 'title',
                value: 'second',
            },
        ]

        expect(() => test({ logEntries })).toThrow(
            `Detected modification to collection 'customList', pk '"list-one"' before it was created (likely pk collision)`,
        )
    })
})
