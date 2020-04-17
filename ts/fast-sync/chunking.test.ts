import expect from 'expect'
import {
    calculateStringChunkCount,
    getStringChunk,
    receiveInChucks,
} from './chunking'
import Interruptable from './interruptable'

describe('Fast sync channel package chunking', () => {
    it('should calculate the right chunk count for strings exactly fitting the chunk size', () => {
        expect(calculateStringChunkCount('abcdefgh', { chunkSize: 4 })).toEqual(
            2,
        )
    })

    it('should calculate the right chunk count for strings not exactly fitting the chunk size', () => {
        expect(calculateStringChunkCount('abcdefgh', { chunkSize: 4 })).toEqual(
            2,
        )
    })

    it('should correctly get chunks for strings exactly fitting the chunk size', () => {
        expect(getStringChunk('abcdefgh', 0, { chunkSize: 4 })).toEqual('abcd')
        expect(getStringChunk('abcdefgh', 1, { chunkSize: 4 })).toEqual('efgh')
    })

    it('should correctly get chunks for strings not exactly fitting the chunk size', () => {
        expect(getStringChunk('abcdef', 0, { chunkSize: 4 })).toEqual('abcd')
        expect(getStringChunk('abcdef', 1, { chunkSize: 4 })).toEqual('ef')
    })

    it('should correctly receive data in chunks', async () => {
        const chunks = [`chunk:0:3:ab`, `chunk:1:3:cde`, `chunk:2:3:fghij`]

        const interruptable = new Interruptable()
        expect(
            await receiveInChucks(async () => chunks.shift()!, interruptable),
        ).toEqual('abcdefghij')
    })

    it('should throw an exception when cancelled', async () => {
        const chunks = [`chunk:0:3:ab`, `chunk:1:3:cde`, `chunk:2:3:fghij`]
        let index = -1

        const interruptable = new Interruptable({ throwOnCancelled: true })
        await expect(
            receiveInChucks(async () => {
                ++index
                if (index === 1) {
                    await interruptable.cancel()
                }
                return chunks.shift()!
            }, interruptable),
        ).rejects.toThrow('Tried to execute code on a cancelled interruptable')
    })
})
