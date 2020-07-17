import { StorageRegistry, OperationBatch } from '@worldbrain/storex'
import expect from 'expect'
import { ClientSyncLogEntry } from '../client-sync-log/types'
import { reconcileSyncLog } from './default'
import { DoubleCreateBehaviour } from './types'

function test({
    logEntries,
    expectedOperations,
    doubleCreateBehaviour,
    debug,
}: {
    logEntries: ClientSyncLogEntry[]
    expectedOperations?: OperationBatch
    doubleCreateBehaviour?: DoubleCreateBehaviour
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

    const reconciled = reconcileSyncLog(logEntries, {
        storageRegistry,
        debug,
        doubleCreateBehaviour,
    })
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
    ['creation', 'creation'],
    ['modification', 'modification'],
    ['creation', 'deletion', 'recreation'],
    ['deletion', 'recreation', 'redeletion'],
    ['deletion', 'modification'],
]

const ACTION_ENTRIES: {
    [key in Event]: ClientSyncLogEntry
} = {
    creation: {
        deviceId: 'device-one',
        operation: 'create',
        createdOn: 1,
        sharedOn: 52525252,
        needsIntegration: 0,
        collection: 'customList',
        pk: 'list-one',
        value: { id: 'list-one', title: 'List one' },
    },
    modification: {
        id: 1,
        deviceId: 'device-one',
        createdOn: 2,
        sharedOn: 525252,
        needsIntegration: 1,
        collection: 'customList',
        pk: 'list-one',
        field: 'title',
        operation: 'modify',
        value: 'List (updated)',
    },
    deletion: {
        deviceId: 'device-one',
        operation: 'delete',
        createdOn: 1,
        sharedOn: 52525252,
        needsIntegration: 0,
        collection: 'customList',
        pk: 'list-one',
    },
    recreation: {
        deviceId: 'device-one',
        operation: 'create',
        createdOn: 1,
        sharedOn: 52525252,
        needsIntegration: 0,
        collection: 'customList',
        pk: 'list-one',
        value: { title: 'List one recreated' },
    },
    redeletion: {
        deviceId: 'device-one',
        operation: 'delete',
        createdOn: 1,
        sharedOn: 52525252,
        needsIntegration: 0,
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

interface TestSuiteConfiguration {
    doubleCreateBehaviour: DoubleCreateBehaviour
}
interface TestSuiteContext {
    scenario: (
        description: string,
        test: (testContext: SyncTestContext) => void,
    ) => void
}
type TestSuite = (suiteContext: TestSuiteContext) => void
class TestCreator {
    tested: Array<SyncFlowTestInfo> = []

    suite(flow: Event[], suite: TestSuite) {
        describe('should correctly handle ' + flow.join(', '), () => {
            const flowInfo: SyncFlowTestInfo = { flow, scenarios: [] }
            this.tested.push(flowInfo)

            let configuration: TestSuiteConfiguration = {
                doubleCreateBehaviour: 'error',
            }

            suite({
                scenario: (description, scenario) => {
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
                logEntries: [entry('creation', { needsIntegration: 1 })],
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
                            needsIntegration: 0,
                            value: 'First title update',
                        }),
                        entry('modification', {
                            needsIntegration: 1,
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
                        needsIntegration: 1,
                        value: 'First title update',
                    }),
                    entry('modification', {
                        needsIntegration: 1,
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

    TEST_CREATOR.suite(['creation', 'creation'], ({ scenario }) => {
        scenario(
            'with only the second update needing integration',
            ({ entry }) => {
                test({
                    doubleCreateBehaviour: 'merge',
                    logEntries: [
                        entry('creation', {
                            needsIntegration: 0,
                            value: {
                                id: 'list-one',
                                title: 'first entry title',
                            },
                        }),
                        entry('creation', {
                            needsIntegration: 1,
                            value: {
                                id: 'list-one',
                                title: 'second entry title',
                            },
                        }),
                    ],
                    expectedOperations: [
                        {
                            operation: 'updateObjects',
                            collection: 'customList',
                            where: { id: 'list-one' },
                            updates: { title: 'second entry title' },
                        },
                    ],
                })
            },
        )

        scenario('with all entries needing integration', ({ entry }) => {
            test({
                doubleCreateBehaviour: 'merge',
                logEntries: [
                    entry('creation', {
                        needsIntegration: 1,
                        value: { id: 'list-one', title: 'first entry title' },
                    }),
                    entry('creation', {
                        needsIntegration: 1,
                        value: { id: 'list-one', title: 'second entry title' },
                    }),
                ],
                expectedOperations: [
                    {
                        operation: 'createObject',
                        collection: 'customList',
                        args: { id: 'list-one', title: 'second entry title' },
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
                        entry('creation', { needsIntegration: 0 }),
                        entry('modification', { needsIntegration: 0 }),
                        entry('deletion', { needsIntegration: 1 }),
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
                            entry('creation', { needsIntegration: 0 }),
                            entry('modification', { needsIntegration: 1 }),
                            entry('deletion', { needsIntegration: 1 }),
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
                        entry('creation', { needsIntegration: 1 }),
                        entry('modification', { needsIntegration: 1 }),
                        entry('deletion', { needsIntegration: 1 }),
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
                        entry('creation', { needsIntegration: 0 }),
                        entry('modification', {
                            needsIntegration: 0,
                            value: 'first',
                        }),
                        entry('modification', {
                            needsIntegration: 0,
                            value: 'second',
                        }),
                        entry('deletion', { needsIntegration: 1 }),
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
                            entry('creation', { needsIntegration: 0 }),
                            entry('modification', {
                                needsIntegration: 0,
                                value: 'first',
                            }),
                            entry('modification', {
                                needsIntegration: 1,
                                value: 'second',
                            }),
                            entry('deletion', { needsIntegration: 1 }),
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
                            entry('creation', { needsIntegration: 0 }),
                            entry('modification', {
                                needsIntegration: 1,
                                value: 'first',
                            }),
                            entry('modification', {
                                needsIntegration: 1,
                                value: 'second',
                            }),
                            entry('deletion', { needsIntegration: 1 }),
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
                        entry('creation', { needsIntegration: 1 }),
                        entry('modification', {
                            needsIntegration: 1,
                            value: 'first',
                        }),
                        entry('modification', {
                            needsIntegration: 1,
                            value: 'second',
                        }),
                        entry('deletion', { needsIntegration: 1 }),
                    ],
                    expectedOperations: [],
                })
            })
        },
    )

    it('should choose the newest write when finding two entries for the same object field', () => {
        const logEntries: ClientSyncLogEntry[] = [
            {
                deviceId: 'device-one',
                operation: 'modify',
                createdOn: 2,
                sharedOn: 52525252,
                needsIntegration: 1,
                collection: 'customList',
                pk: 'list-one',
                field: 'title',
                value: 'second',
            },
            {
                deviceId: 'device-one',
                operation: 'modify',
                createdOn: 1,
                sharedOn: 52525252,
                needsIntegration: 1,
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
                deviceId: 'device-one',
                operation: 'modify',
                createdOn: 2,
                sharedOn: 52525252,
                needsIntegration: 1,
                collection: 'customList',
                pk: 'list-one',
                field: 'title',
                value: 'second',
            },
            {
                deviceId: 'device-one',
                operation: 'delete',
                createdOn: 1,
                sharedOn: 52525252,
                needsIntegration: 1,
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
                deviceId: 'device-one',
                operation: 'delete',
                createdOn: 1,
                sharedOn: 3,
                needsIntegration: 1,
                collection: 'customList',
                pk: 'list-one',
            },
            {
                deviceId: 'device-one',
                operation: 'modify',
                createdOn: 2,
                sharedOn: 52525252,
                needsIntegration: 1,
                collection: 'customList',
                pk: 'list-one',
                field: 'title',
                value: 'second',
            },
            {
                deviceId: 'device-one',
                operation: 'delete',
                createdOn: 4,
                sharedOn: 3,
                needsIntegration: 1,
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
                deviceId: 'device-one',
                operation: 'delete',
                createdOn: 1,
                sharedOn: 52525252,
                needsIntegration: 1,
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
                deviceId: 'device-one',
                operation: 'delete',
                createdOn: 1,
                sharedOn: 52525252,
                needsIntegration: 1,
                collection: 'customList',
                pk: 'list-one',
            },
            {
                deviceId: 'device-one',
                operation: 'delete',
                createdOn: 4,
                sharedOn: 52525252,
                needsIntegration: 1,
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
                deviceId: 'device-one',
                operation: 'delete',
                createdOn: 4,
                sharedOn: 52525252,
                needsIntegration: 1,
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
                    entry('creation', { needsIntegration: 0 }),
                    entry('modification', { needsIntegration: 1 }),
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
                    entry('creation', { needsIntegration: 1 }),
                    entry('modification', { needsIntegration: 1 }),
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
                deviceId: 'device-one',
                operation: 'modify',
                createdOn: 2,
                sharedOn: 52525252,
                needsIntegration: 1,
                collection: 'customList',
                pk: 'list-one',
                field: 'title',
                value: 'second',
            },
            {
                deviceId: 'device-one',
                operation: 'create',
                createdOn: 1,
                sharedOn: 52525252,
                needsIntegration: 1,
                collection: 'customList',
                pk: 'list-one',
                value: { pk: 'list-one', title: 'first', prio: 5 },
            },
            {
                deviceId: 'device-one',
                operation: 'delete',
                createdOn: 3,
                sharedOn: 52525252,
                needsIntegration: 1,
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
                            entry('creation', { needsIntegration: 0 }),
                            entry('deletion', { needsIntegration: 0 }),
                            entry('recreation', { needsIntegration: 1 }),
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
                            entry('creation', { needsIntegration: 0 }),
                            entry('deletion', { needsIntegration: 1 }),
                            entry('recreation', { needsIntegration: 1 }),
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
                        entry('creation', { needsIntegration: 1 }),
                        entry('deletion', { needsIntegration: 1 }),
                        entry('recreation', { needsIntegration: 1 }),
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
                        entry('deletion', { needsIntegration: 0 }),
                        entry('recreation', { needsIntegration: 0 }),
                        entry('redeletion', { needsIntegration: 1 }),
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
                            entry('deletion', { needsIntegration: 0 }),
                            entry('recreation', { needsIntegration: 1 }),
                            entry('redeletion', { needsIntegration: 1 }),
                        ],
                        expectedOperations: [],
                    })
                },
            )

            scenario('with all entries needing integration', ({ entry }) => {
                test({
                    logEntries: [
                        entry('deletion', { needsIntegration: 1 }),
                        entry('recreation', { needsIntegration: 1 }),
                        entry('redeletion', { needsIntegration: 1 }),
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
                    entry('deletion', { needsIntegration: 0 }),
                    entry('modification', { needsIntegration: 1 }),
                ],
                expectedOperations: [],
            })
        })

        scenario('with all entries needing integration', ({ entry }) => {
            test({
                logEntries: [
                    entry('deletion', { needsIntegration: 1 }),
                    entry('modification', { needsIntegration: 1 }),
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
                deviceId: 'device-one',
                operation: 'delete',
                createdOn: 2,
                sharedOn: 52525252,
                needsIntegration: 1,
                collection: 'customList',
                pk: 'list-one',
            },
            {
                deviceId: 'device-one',
                operation: 'create',
                createdOn: 3,
                sharedOn: 52525252,
                needsIntegration: 1,
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
                deviceId: 'device-one',
                operation: 'create',
                createdOn: 1,
                sharedOn: 1,
                needsIntegration: 1,
                collection: 'customList',
                pk: 'list-one',
                value: { pk: 'list-one', title: 'first', prio: 5 },
            },
            {
                deviceId: 'device-one',
                operation: 'create',
                createdOn: 2,
                sharedOn: 52525252,
                needsIntegration: 1,
                collection: 'customList',
                pk: 'list-one',
                value: { pk: 'list-one', title: 'first', prio: 5 },
            },
        ]

        expect(() => test({ logEntries })).toThrow(
            `Detected double create in collection 'customList', pk '"list-one"'`,
        )
    })
})
