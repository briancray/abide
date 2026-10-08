import { spawned } from './spawned.ts'

const DEFAULT_TIMEOUT_MILLISECONDS = 30_000

/**
 * Runs `source` in a child bun with no DOM preload and no worker mark (unless `workerId` is set).
 *
 * Two of the harness's refusals are about the process a number is taken in — `retained()` throws
 * where a DOM is preloaded (44.16), the batcher throws in a parallel worker (44.18) — and
 * `bunfig.toml` preloads happy-dom into every `bun test` process while `bun run test` runs them
 * all under `--parallel`. So a gate on either refusal cannot be taken in the suite that states
 * it: it is taken in a child.
 *
 * PART OF THE VOCABULARY RATHER THAN OF THIS PACKAGE'S TESTS, which is where it started and where
 * it could not do its job. Every allocation gate in the framework needs this same preload-free
 * invocation, and a helper sitting in `packages/harness/tests/` is one `packages/abide/tests/` can
 * only reach by copying. It belongs beside `gate()` for the same reason `gate()` is a fifth
 * entry: both need `bun:test`, and neither is a lane.
 *
 * It is also the only place a HANG can be gated. `bun test`'s own per-test timeout is a timer, so
 * a body that starves the event loop outruns it and the suite reports nothing at all — no failed
 * test, no summary. A child is killed by a timer in THIS process rather than by one inside the
 * process it is measuring — and `spawned` is how, awaited rather than synchronous, its throw at
 * the deadline being the failed test.
 */
export async function inAFreshProcess(
    source: string,
    workerId?: string,
    timeoutMilliseconds = DEFAULT_TIMEOUT_MILLISECONDS,
): Promise<{ ok: boolean; output: string }> {
    const environment: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env))
        if (value !== undefined && key !== 'BUN_TEST_WORKER_ID')
            environment[key] = value
    if (workerId !== undefined) environment.BUN_TEST_WORKER_ID = workerId
    const run = await spawned(['bun', '-e', source], {
        cwd: new URL('../../../../', import.meta.url).pathname,
        env: environment,
        deadline: timeoutMilliseconds,
    })
    return { ok: run.exitCode === 0, output: run.stdout + run.stderr }
}
