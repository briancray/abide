import { execFileSync } from 'node:child_process'

const REPO = new URL('../../../', import.meta.url).pathname

/** The path of the bench bundle `bench/buildBench.ts` builds for `name`: the last line it prints. */
export function builtBench(name: string): string {
    return execFileSync('bun', ['packages/abide/bench/buildBench.ts', name], {
        cwd: REPO,
        encoding: 'utf8',
    })
        .trim()
        .split('\n')
        .pop() as string
}
