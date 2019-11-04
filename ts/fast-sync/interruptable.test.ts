import expect from 'expect'
import Interruptable from './interruptable'

describe('Interruptable', () => {
    it('should not execute steps if canceled', async () => {
        const calls: number[] = []
        const step = async () => {
            calls.push(calls.length)
        }

        const interruptable = new Interruptable()
        await interruptable.execute(step)
        expect(calls).toEqual([0])
        await interruptable.cancel()
        await interruptable.execute(step)
        expect(calls).toEqual([0])
    })

    it('should allow for pausable execute steps', async () => {
        const calls: number[] = []
        const step = async () => {
            calls.push(calls.length)
        }

        const interruptable = new Interruptable()
        await interruptable.execute(step)
        expect(calls).toEqual([0])

        await interruptable.pause()
        const promise = interruptable.execute(step)
        expect(calls).toEqual([0])

        await interruptable.resume()
        await promise
        expect(calls).toEqual([0, 1])
        await interruptable.execute(step)
        expect(calls).toEqual([0, 1, 2])
    })

    it('should allow for canceling while loops', async () => {
        const interruptable = new Interruptable()
        await interruptable.whileLoop(
            async () => true,
            async () => {
                interruptable.cancel()
            },
        )
    })

    it('should allow for pausing while loops', async () => {
        const loops: number[] = []

        const interruptable = new Interruptable()
        const promise = interruptable.whileLoop(
            async () => loops.length < 2,
            async () => {
                loops.push(loops.length)
                await interruptable.pause()
            },
        )

        await new Promise(resolve => setTimeout(resolve, 200))
        expect(loops).toEqual([0])
        await interruptable.resume()
        await promise
        expect(loops).toEqual([0, 1])
    })

    it('should allow for canceling for ... of loops', async () => {
        const loops: number[] = []

        const interruptable = new Interruptable()
        const promise = interruptable.forOfLoop([1, 2], async item => {
            loops.push(item)
            interruptable.cancel()
        })

        await promise
        expect(loops).toEqual([1])
    })

    it('should allow for pausing for ... of loops', async () => {
        const loops: number[] = []

        const interruptable = new Interruptable()
        await interruptable.pause()
        const promise = interruptable.forOfLoop([1, 2], async item => {
            loops.push(item)
        })

        expect(loops).toEqual([])
        await interruptable.resume()
        await promise
        expect(loops).toEqual([1, 2])
    })
})
