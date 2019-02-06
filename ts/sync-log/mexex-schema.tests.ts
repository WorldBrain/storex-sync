import { StorageModule, StorageModuleConfig } from "@worldbrain/storex-pattern-modules";

export class PageStorage extends StorageModule {
    getConfig() : StorageModuleConfig {
        return {
            collections: {
                pages: {
                    version: new Date(2018, 1, 1),
                    fields: {
                        url: { type: 'string' },
                        text: { type: 'text' },
                        domain: { type: 'string' },
                        hostname: { type: 'string' },
                        screenshot: { type: 'media' },
                    },
                    indices: [
                        { field: 'url', pk: true },
                        { field: 'text', fullTextIndexName: 'terms' },
                        { field: 'domain' },
                    ],
                },
            },
            operations: {}
        }
    }
}

export class VisitsStorage extends StorageModule {
    getConfig() : StorageModuleConfig {
        return {
            collections: {
                visits: {
                    version: new Date(2018, 1, 1),
                    fields: {
                        url: { type: 'string' },
                        time: { type: 'timestamp' },
                        duration: { type: 'int' },
                        scrollMaxPerc: { type: 'float' },
                    },
                    indices: [
                        { field: ['time', 'url'], pk: true },
                        { field: 'url' }
                    ],
                },
            },
            operations: {}
        }
    }
}

export class BookmarksStorage extends StorageModule {
    getConfig() : StorageModuleConfig {
        return {
            collections: {
                bookmarks: {
                    version: new Date(2018, 1, 1),
                    fields: {
                        url: { type: 'string' },
                        time: { type: 'timestamp' },
                    },
                    indices: [{ field: 'url', pk: true }, { field: 'time' }],
                },
            },
            operations: {}
        }
    }
}

export class TagsStorage extends StorageModule {
    getConfig() : StorageModuleConfig {
        return {
            collections: {
                tags: {
                    version: new Date(2018, 1, 1),
                    fields: {
                        url: { type: 'string' },
                        name: { type: 'string' },
                    },
                    indices: [
                        { field: ['name', 'url'], pk: true },
                        { field: 'name' },
                        { field: 'url' },
                    ],
                },
            },
            operations: {}
        }
    }
}

export class FavIconsStorage extends StorageModule {
    getConfig() : StorageModuleConfig {
        return {
            collections: {
                favIcons: {
                    version: new Date(2018, 1, 1),
                    fields: {
                        hostname: { type: 'string' },
                        favIcon: { type: 'media' },
                    },
                    indices: [{ field: 'hostname', pk: true }],
                },
            },
            operations: {}
        }
    }
}

export class NotificationStorage extends StorageModule {
    getConfig() : StorageModuleConfig {
        return {
            collections: {
                notifications: {
                    version: new Date(2018, 7, 4),
                    fields: {
                        id: { type: 'string' },
                        title: { type: 'string' },
                        message: { type: 'string' },
                        buttonText: { type: 'string' },
                        link: { type: 'string' },
                        sentTime: { type: 'datetime' },
                        deliveredTime: { type: 'datetime' },
                        readTime: { type: 'datetime' },
                    },
                    indices: [{ field: 'id', pk: true }],
                },
            },
            operations: {}
        }
    }
}

export class CustomListsStorage extends StorageModule {
    getConfig() : StorageModuleConfig {
        return {
            collections: {
                customLists: {
                    version: new Date(2018, 6, 12),
                    fields: {
                        id: { type: 'string', pk: true },
                        name: { type: 'string' },
                        isDeletable: { type: 'boolean' },
                        isNestable: { type: 'boolean' },
                        createdAt: { type: 'datetime' },
                    },
                    indices: [
                        { field: 'id', pk: true },
                        { field: 'name', unique: true },
                        { field: 'isDeletable' },
                        { field: 'isNestable' },
                        { field: 'createdAt' },
                    ],
                },
                pageListEntries: {
                    version: new Date(2018, 6, 12),
                    fields: {
                        listId: { type: 'string' },
                        pageUrl: { type: 'string' },
                        fullUrl: { type: 'string' },
                        createdAt: { type: 'datetime' },
                    },
                    indices: [
                        { field: ['listId', 'pageUrl'], pk: true },
                        { field: 'listId' },
                        { field: 'pageUrl' },
                    ],
                },
            },
            operations: {}
        }
    }
}

export class AnnotationsStorage extends StorageModule {
    getConfig() : StorageModuleConfig {
        return {
            collections: {
                annotations: {
                    version: new Date(2018, 7, 26),
                    fields: {
                        pageTitle: { type: 'text' },
                        pageUrl: { type: 'url' },
                        body: { type: 'text' },
                        comment: { type: 'text' },
                        selector: { type: 'json' },
                        createdWhen: { type: 'datetime' },
                        lastEdited: { type: 'datetime' },
                        url: { type: 'string' },
                    },
                    indices: [
                        { field: 'url', pk: true },
                        { field: 'pageTitle' },
                        { field: 'body' },
                        { field: 'createdWhen' },
                        { field: 'comment' },
                    ],
                },
                annotationListEntries: {
                    version: new Date(2019, 0, 4),
                    fields: {
                        listId: { type: 'string' },
                        url: { type: 'string' },
                        createdAt: { type: 'datetime' },
                    },
                    indices: [
                        { field: ['listId', 'url'], pk: true },
                        { field: 'listId' },
                        { field: 'url' },
                    ],
                },
                annotationBookmarks: {
                    version: new Date(2019, 0, 5),
                    fields: {
                        url: { type: 'string' },
                        createdAt: { type: 'datetime' },
                    },
                    indices: [{ field: 'url', pk: true }, { field: 'createdAt' }],
                }
            },
            operations: {}
        }
    }
}
