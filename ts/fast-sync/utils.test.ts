import expect from 'expect'
import { splitWithTail } from './utils'

describe('splitWithTail', () => {
    it('should work for strings that have less delimiters than the limit without a trailing delimiter', () => {
        expect(splitWithTail('a:bc', ':', 3)).toEqual(['a', 'bc'])
    })
    it('should work for strings that have more delimiters than the limit without a trailing delimiter', () => {
        expect(splitWithTail('a:bc:de:fg:hi:jk', ':', 3)).toEqual([
            'a',
            'bc',
            'de:fg:hi:jk',
        ])
    })
    it('should work for strings that have less delimiters than the limit with a trailing delimiter', () => {
        expect(splitWithTail('a:', ':', 3)).toEqual(['a', ''])
    })
    it('should work for strings that have more delimiters than the limit with a trailing delimiter', () => {
        expect(splitWithTail('a:bc:de:fg:hi:jk:', ':', 3)).toEqual([
            'a',
            'bc',
            'de:fg:hi:jk:',
        ])
    })
    it('should work for strings that have the delimiter as the first char', () => {
        expect(splitWithTail(':bc:de:fg:hi:jk', ':', 3)).toEqual([
            '',
            'bc',
            'de:fg:hi:jk',
        ])
    })
})
