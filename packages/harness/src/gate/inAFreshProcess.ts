// A BUN PROCESS WITH NO DOM AND NO WORKER MARK. Two of the harness's refusals are
// about the process a number is taken in — `retained()` throws where a DOM is
// preloaded (44.16), the batcher throws in a parallel worker (44.18) — and
// `bunfig.toml` preloads happy-dom into every `bun test` process while `bun run test`
// runs them all under `--parallel`. So a gate on either refusal cannot be taken in the
// suite that states it: it is taken in a child.
//
// PART OF THE VOCABULARY RATHER THAN OF THIS PACKAGE'S TESTS, which is where it started
// and where it could not do its job. Every allocation gate in the framework needs this
// same preload-free invocation — `SERVER.md` orders six on `retained` and `REACTIVE.md`
// orders `Link` allocations — and a helper sitting in `packages/harness/tests/` is one
// `packages/abide/tests/` can only reach by copying. It belongs beside `gate()` for the
// same reason `gate()` is a fifth entry: both need `bun:test`, and neither is a lane.
//
// It is also the only place a HANG can be gated. `bun test`'s own per-test timeout is a
// timer, so a body that starves the event loop outruns it and the suite reports nothing
// at all — no failed test, no summary. A child with a `timeout` is killed by the OS
// rather than by a timer inside the process it is measuring.
const DEFAULT_TIMEOUT_MILLISECONDS = 30_000

export function inAFreshProcess(
    source: string,
    workerId?: string,
    timeoutMilliseconds = DEFAULT_TIMEOUT_MILLISECONDS,
): { ok: boolean; output: string; timedOut: boolean } {
    const environment: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env))
        if (value !== undefined && key !== 'BUN_TEST_WORKER_ID')
            environment[key] = value
    if (workerId !== undefined) environment.BUN_TEST_WORKER_ID = workerId
    const run = Bun.spawnSync({
        cmd: ['bun', '-e', source],
        cwd: new URL('../../../../', import.meta.url).pathname,
        env: environment,
        stderr: 'pipe',
        stdout: 'pipe',
        timeout: timeoutMilliseconds,
    })
    return {
        ok: run.exitCode === 0,
        output: run.stdout.toString() + run.stderr.toString(),
        timedOut: run.exitCode === null,
    }
}
