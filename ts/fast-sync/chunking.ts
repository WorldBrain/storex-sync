import { splitWithTail } from './utils'
import Interruptable from './interruptable'

export function calculateStringChunkCount(
    s: string,
    options: { chunkSize: number },
): number {
    return Math.ceil(s.length / options.chunkSize)
}

export function getStringChunk(
    s: string,
    chunkIndex: number,
    options: { chunkSize: number },
): string {
    return s.substr(chunkIndex * options.chunkSize, options.chunkSize)
}

export async function receiveInChucks(
    receiveChunk: () => Promise<string>,
    interruptable: Interruptable,
): Promise<string> {
    let data: string[] = []
    let expectedChunkCount: null | number = null

    const processChunk = (chunk: string) => {
        const [
            chunkConfirmation,
            chunkIndexString,
            chunkCountString,
            chunkContent,
        ] = splitWithTail(chunk, ':', 4)
        if (chunkConfirmation !== 'chunk') {
            throw new Error(`Invalid WebRTC chunk package received: ${chunk}`)
        }

        const chunkIndex = parseInt(chunkIndexString)
        if (chunkIndex === NaN) {
            throw new Error(
                `Received WebRTC package with invalid chunk index: ${chunkIndexString}`,
            )
        }

        if (chunkIndex !== data.length) {
            throw new Error(
                `Received WebRTC package chunk index ${chunkIndexString}, ` +
                    `but was expecting chunk index ${data.length}`,
            )
        }

        const chunkCount = parseInt(chunkCountString)
        if (chunkCount === NaN) {
            throw new Error(
                `Received WebRTC package with invalid chunk size: ${chunkIndexString}`,
            )
        }

        if (expectedChunkCount) {
            if (chunkCount !== expectedChunkCount) {
                throw new Error(
                    `Received WebRTC packge with chunk count ${chunkCount}, ` +
                        `but we received a previous package with chunk count ${expectedChunkCount}`,
                )
            }
        } else {
            expectedChunkCount = chunkCount
        }

        data.push(chunkContent)
        return { finished: data.length === expectedChunkCount }
    }

    let running = true
    await interruptable.whileLoop(
        async () => running,
        async () => {
            const chunk = (await interruptable.execute(receiveChunk))!
            const result = await interruptable.execute(async () =>
                processChunk(chunk),
            )
            if (result?.finished) {
                running = false
            }
        },
    )

    return data.join('')
}

export async function sendInChunks(
    message: string,
    send: (chunk: string) => Promise<void>,
    options: {
        interruptable: Interruptable
        chunkSize: number
    },
) {
    const chunkCount = calculateStringChunkCount(message, options)
    let chunkIndex = -1
    await options.interruptable.whileLoop(
        async () => chunkIndex < chunkCount,
        async () => {
            chunkIndex += 1
            const chunkContent = getStringChunk(message, chunkIndex, {
                chunkSize: options.chunkSize,
            })
            await send(`chunk:${chunkIndex}:${chunkCount}:${chunkContent}`)
        },
    )
}
