// 38.31 — AN APP WITH NO tsconfig.json IS TYPED AGAINST ONE OF ABIDE'S, not read untyped. The checker
// is what tells the compiler which names are `Reactive`s (31.3), and with no project to ask every
// template position read as static: the server painted an unlanded read by throwing out of the
// render (41.4), the client never bound a slot at all, and `props` went unseen — an app that built
// clean and did nothing. So the absence of a project gets a project rather than a second compiler.
//
// WRITTEN OUTSIDE THE APP. The build does not write into an author's source tree, so the file lives
// in a temporary directory for as long as the session that reads it, and names the app's files by
// absolute path.

import { mkdtemp, rm } from 'node:fs/promises' // bun exposes no temporary-directory creation or recursive removal of its own
import { tmpdir } from 'node:os' // bun exposes no temporary-directory path of its own

// What every abide app in the docs and the scaffold is written against.
const COMPILER_OPTIONS = {
    strict: true,
    target: 'esnext',
    module: 'preserve',
    moduleResolution: 'bundler',
    allowImportingTsExtensions: true,
    noEmit: true,
    skipLibCheck: true,
}

export async function defaultProject(
    root: string,
): Promise<{ tsconfig: string; remove: () => Promise<void> }> {
    const directory = await mkdtemp(`${tmpdir()}/abide-project-`)
    const tsconfig = `${directory}/tsconfig.json`
    await Bun.write(
        tsconfig,
        JSON.stringify({
            compilerOptions: COMPILER_OPTIONS,
            include: [`${root}/**/*`],
        }),
    )
    return {
        tsconfig,
        remove: () => rm(directory, { recursive: true, force: true }),
    }
}
