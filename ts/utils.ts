import { StorageRegistry } from "@worldbrain/storex";

export function getObjectPk(object, collection : string, registry : StorageRegistry) {
    const pkIndex = registry.collections[collection].pkIndex
    if (typeof pkIndex === 'string') {
        return object[pkIndex]
    }

    const pk = []
    for (const indexField of pkIndex) {
        if (typeof indexField === 'string') {
            pk.push(object[indexField])
        } else {
            throw new Error(`getObject() called with relationship as pk, which is not supported yet.`)
        }
    }
    return pk
}

export function getObjectWithoutPk(object, collection : string, registry : StorageRegistry) {
    object = { ...object }

    const pkIndex = registry.collections[collection].pkIndex
    if (typeof pkIndex === 'string') {
        delete object[pkIndex]
        return object
    }

    for (const indexField of pkIndex) {
        if (typeof indexField === 'string') {
            delete object[indexField]
        } else {
            throw new Error(`getObject() called with relationship as pk, which is not supported yet.`)
        }
    }
    return object
}

export function setObjectPk(object, pk, collection : string, registry : StorageRegistry) {
    const collectionDefinition = registry.collections[collection]
    if (!collectionDefinition) {
        throw new Error(`Could not find collection definition for '${collection}'`)
    }

    const pkIndex = collectionDefinition.pkIndex
    if (typeof pkIndex === 'string') {
        object[pkIndex] = pk
        return object
    }

    let indexFieldIdx = 0
    for (const indexField of pkIndex) {
        if (typeof indexField === 'string') {
            object[indexField] = pk[indexFieldIdx++]
        } else {
            throw new Error(`setObjectPk() called with relationship as pk, which is not supported yet.`)
        }
    }

    return object
}
