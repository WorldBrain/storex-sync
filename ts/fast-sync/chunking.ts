import { splitWithTail } from './utils'

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
): Promise<string> {
    let data: string[] = []
    let expectedChunkCount: null | number = null

    while (true) {
        const chunk = await receiveChunk()

        const [
            chunkConfirmation,
            chunkIndexString,
            chunkCountString,
            chunkContent,
        ] = splitWithTail(chunk, ':', 4)
        if (chunkConfirmation !== 'chunk') {
            throw new Error(`Invalid WebRTC package received: ${chunk}`)
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
        if (data.length === expectedChunkCount) {
            break
        }
    }

    return data.join('')
}
