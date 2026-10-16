// The reactive core's code lines against the hand-written signal's — the LOC leg of the machinery
// budget, shared by `bench:reactive` and the bench page so the two cannot print different numbers.

import { countLines } from './countLines.ts'

/** Code lines in the reactive core and in the hand-written signal it is budgeted against. */
export async function reactiveCoreLines(): Promise<{
    abide: number
    vanilla: number
}> {
    // GLOBBED, not listed: the hand-written list this replaced had fallen ten files behind the
    // directory, so the budget it printed left out everything the core had grown by.
    const core = new URL('../src/shared/reactive/', import.meta.url)
    return {
        abide: await countLines(core, [
            ...new Bun.Glob('*.ts').scanSync({ cwd: core.pathname }),
        ]),
        vanilla: await countLines(new URL('./', import.meta.url), [
            'signal.ts',
        ]),
    }
}
