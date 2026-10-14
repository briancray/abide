// A `.abide` source compiled and imported as the server component it emits — what the render and
// component benches time, and what the bench page runs them through. One checker session per run:
// opening one is seconds, and every compile after it is not.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs' // bun has no sync mkdtemp/rm of its own
import { emitComponent, parseAbide, TypeSession } from '@abide/abide/compiler'

const REPO = new URL('../../../', import.meta.url).pathname

export type Render = () => { head: string; body: string }

/**
 * Opens one checker session and returns `compile`, which turns a source into an imported server
 * component, and `close`, which ends the session and removes every emitted module.
 */
export async function openBenchCompiler(): Promise<{
    compile: (
        name: string,
        source: string,
        beside?: Record<string, string>,
    ) => Promise<{ module: string; render: Render }>
    close: () => void
}> {
    const session = await TypeSession.open(
        `${REPO}packages/abide/tsconfig.json`,
    )
    const made: string[] = []
    return {
        /**
         * Compiles `source` as `name` and returns the emitted module and its imported render.
         *
         * The emitted module, written where the tests write theirs — outside `packages/abide`, so
         * `conventions.test.ts`'s glob does not scan it. ITS OWN DIR PER CALL, because an import
         * path is cached: a second `Page.ts` at a path already imported hands back the first
         * size's module.
         */
        async compile(name, source, beside = {}) {
            const file = parseAbide(source)
            const reads = await session.reads(
                `${REPO}packages/abide/tests/fixtures/typed/src/${name}.abide`,
                file,
            )
            // A component import is emitted as the file's `?component` face, which only abide's
            // module loader resolves; here the sibling is the emitted module written `beside`.
            const module = emitComponent(file, reads).replace(
                /\.abide\?component'/g,
                ".ts'",
            )
            const dir = mkdtempSync(`${REPO}.test-modules/bench-`)
            made.push(dir)
            for (const [at, text] of Object.entries(beside))
                writeFileSync(`${dir}/${at}`, text)
            writeFileSync(`${dir}/${name}.ts`, module)
            const loaded = (await import(`${dir}/${name}.ts`)) as {
                default: Render
            }
            return { module, render: loaded.default }
        },
        close() {
            session.close()
            for (const dir of made)
                rmSync(dir, { recursive: true, force: true })
        },
    }
}
