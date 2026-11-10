import { execFileSync } from 'node:child_process'

import type { CompiledPage } from '../bench/buildCompiledPage.ts'

const REPO = new URL('../../../', import.meta.url).pathname

/**
 * `buildCompiledPage` run in a bun child: the compiler is bun's, and playwright runs on node. The
 * page is the child's LAST line, so anything the compile logs above it is not parsed.
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
console.log(JSON.stringify(await buildCompiledPage(${JSON.stringify(source)}, ${JSON.stringify(components)})))
`,
        ],
        { cwd: REPO, encoding: 'utf8' },
    )
    return JSON.parse(printed.trim().split('\n').pop() as string)
}
