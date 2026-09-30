import { isRunnerFailure, type RunnerFailure } from 'harness/rows'
import { linesOf } from '#shared/linesOf.ts'

/**
 * Reads a run's newline-delimited JSON rows off `rpc.raw`'s `Response`, handing each to `each`.
 *
 * One JSON row per line, each handed to `each` once, as it lands; a runner-failure row rejects.
 * The call's own value streams and takes a signal too (16.33, 16.52), but it is the ACCUMULATION:
 * a board merging rows into results it already holds would walk the whole of it again for every
 * row that landed.
 */
export async function readRows<Row>(
    response: Response,
    each: (row: Row) => void,
): Promise<void> {
    if (!response.ok || response.body === null)
        throw new Error(`${response.status} ${await response.text()}`)
    for await (const line of linesOf(response.body))
        if (line !== '') handRow(line, each)
}

function handRow<Row>(line: string, each: (row: Row) => void): void {
    const row = JSON.parse(line) as Row | RunnerFailure
    if (isRunnerFailure(row as object))
        throw new Error((row as RunnerFailure).failure)
    each(row as Row)
}
