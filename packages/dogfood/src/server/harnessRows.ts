// THE HARNESS'S TWO ROW RUNNERS, reached from the docs app. Each is a subprocess printing one JSON
// row per line, so a bench never shares this server's process — its clock, its heap, its event loop
// — and a run a reader walked away from is killed rather than finished.
//
// PIPED, NOT READ. The rows are passed on as the runner wrote them; `harness/rows` is the contract.

import { request } from 'abide/server'
import type { RowItem, RunnerFailure } from 'harness/rows'

let repo: Promise<string> | undefined

// WALKED UP TO, not computed from this file's depth: where the server's modules sit is the
// build's business, and the harness is wherever the workspace put it.
function repoRoot(): Promise<string> {
    repo ??= (async () => {
        let directory = import.meta.dir
        while (
            !(await Bun.file(
                `${directory}/packages/harness/package.json`,
            ).exists())
        ) {
            const parent = directory.slice(0, directory.lastIndexOf('/'))
            if (parent === '' || parent === directory)
                throw new Error('the harness package is not beside this app')
            directory = parent
        }
        return directory
    })()
    return repo
}

async function* runnerLines(
    script: string,
    args: string[],
): AsyncGenerator<string> {
    const child = Bun.spawn({
        cmd: [process.execPath, `packages/harness/scripts/${script}`, ...args],
        cwd: await repoRoot(),
        stdout: 'pipe',
        stderr: 'pipe',
        // KILLED BY THE HANG-UP ITSELF: the stream's cancel only queues a `return` on this generator,
        // and it lands at the next `yield` — a quiet row would otherwise run to its end first.
        signal: request().signal,
    })
    const stderr = new Response(child.stderr).text()
    try {
        const decoder = new TextDecoder()
        let buffered = ''
        for await (const chunk of child.stdout) {
            buffered += decoder.decode(chunk, { stream: true })
            let newline = buffered.indexOf('\n')
            while (newline !== -1) {
                yield buffered.slice(0, newline)
                buffered = buffered.slice(newline + 1)
                newline = buffered.indexOf('\n')
            }
        }
        // A RUNNER THAT DIED reports nothing more, and an empty stream reads as "nothing selected".
        if ((await child.exited) !== 0)
            throw new Error(
                `${script} exited ${child.exitCode}\n${(await stderr).slice(-2000)}`,
            )
    } finally {
        child.kill()
    }
}

export async function harnessCatalog(script: string): Promise<RowItem[]> {
    for await (const line of runnerLines(script, ['--list']))
        return JSON.parse(line) as RowItem[]
    return []
}

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
