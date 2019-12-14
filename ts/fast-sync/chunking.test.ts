import expect from 'expect'
import {
    calculateStringChunkCount,
    getStringChunk,
    receiveInChucks,
} from './chunking'

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

        expect(await receiveInChucks(async () => chunks.shift()!)).toEqual(
            'abcdefghij',
        )
    })
})
