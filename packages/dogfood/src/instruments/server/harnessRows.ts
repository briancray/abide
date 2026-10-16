// THE TWO ROW RUNNERS IN `scripts/`, reached from the docs app. Each is a subprocess printing one JSON
// row per line, so a bench never shares this server's process — its clock, its heap, its event loop
// — and a run a reader walked away from is killed rather than finished.
//
// PIPED, NOT READ. The rows are passed on as the runner wrote them; `@abide/harness/rows` is the contract.

import { request } from '@abide/abide/server'
import type { RowItem, RunnerFailure } from '@abide/harness/rows'
import { linesOf } from '../lib/linesOf.ts'

let repo: Promise<string> | undefined

/**
 * The repo root: the nearest directory above this module holding the docs app's runners.
 *
 * WALKED UP TO, not computed from this file's depth: where the server's modules sit is the
 * build's business, not this file's.
 */
function repoRoot(): Promise<string> {
    repo ??= (async () => {
        let directory = import.meta.dir
        while (
            !(await Bun.file(
                `${directory}/packages/dogfood/scripts/testRows.ts`,
            ).exists())
        ) {
            const parent = directory.slice(0, directory.lastIndexOf('/'))
            if (parent === '' || parent === directory)
                throw new Error('the row runners are not beside this app')
            directory = parent
        }
        return directory
    })()
    return repo
}

/** A harness runner's stdout, line by line, in a subprocess killed when the request hangs up. */
async function* runnerLines(
    script: string,
    args: string[],
): AsyncGenerator<string> {
    const child = Bun.spawn({
        cmd: [process.execPath, `packages/dogfood/scripts/${script}`, ...args],
        cwd: await repoRoot(),
        stdout: 'pipe',
        stderr: 'pipe',
        // KILLED BY THE HANG-UP ITSELF: the stream's cancel only queues a `return` on this generator,
        // and it lands at the next `yield` — a quiet row would otherwise run to its end first.
        signal: request().signal,
    })
    const stderr = new Response(child.stderr).text()
    try {
        yield* linesOf(child.stdout)
        // A RUNNER THAT DIED reports nothing more, and an empty stream reads as "nothing selected".
        if ((await child.exited) !== 0)
            throw new Error(
                `${script} exited ${child.exitCode}\n${(await stderr).slice(-2000)}`,
            )
    } finally {
        child.kill()
    }
}

/** What a runner offers to run: the one JSON line it prints for `--list`. */
export async function harnessCatalog(script: string): Promise<RowItem[]> {
    for await (const line of runnerLines(script, ['--list']))
        return JSON.parse(line) as RowItem[]
    return []
}

/** A runner's JSON rows as it prints them, ending on one `failure` row if it dies. */
export async function* harnessRows<Row>(
    script: string,
    args: string[],
): AsyncGenerator<Row | RunnerFailure> {
    try {
        for await (const line of runnerLines(script, args))
            if (line.startsWith('{')) yield JSON.parse(line) as Row
    } catch (thrown) {
        yield {
            failure: thrown instanceof Error ? thrown.message : String(thrown),
        }
    }
}
