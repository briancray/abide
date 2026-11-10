import { execFileSync } from 'node:child_process'

import type { CompiledPage } from '../bench/buildCompiledPage.ts'

const REPO = new URL('../../../', import.meta.url).pathname

/**
 * `buildCompiledPage` run in a bun child: the compiler is bun's, and playwright runs on node. The
 * page is the child's LAST line, so anything the compile logs above it is not parsed. A thousand-row
 * page prints well past `execFileSync`'s 1 MB default, which fails as ENOBUFS.
 *
 * THE SOURCE GOES IN ON STDIN, not in the script: a thousand-card page is past Linux's 128 KiB cap
 * on one argument, which fails the spawn with E2BIG where macOS's larger limit lets it through.
 */
export function compiledPage(
    source: string,
    components: Record<string, string> = {},
): CompiledPage {
    const printed = execFileSync(
        'bun',
        [
            '-e',
            `
import { buildCompiledPage } from './packages/abide/bench/buildCompiledPage.ts'
const { source, components } = await Bun.stdin.json()
console.log(JSON.stringify(await buildCompiledPage(source, components)))
`,
        ],
        {
            cwd: REPO,
            encoding: 'utf8',
            input: JSON.stringify({ source, components }),
            maxBuffer: 256 * 1024 * 1024,
        },
    )
    return JSON.parse(printed.trim().split('\n').pop() as string)
}
