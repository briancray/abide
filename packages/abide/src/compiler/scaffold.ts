// 38.1 — `abide scaffold <name>`: THE LAYOUT EVERY ABIDE APP HAS, written into `<name>`. There is
// nothing to choose, because what is scaffolded is a root layout, a page, a handler file the page
// calls, a test of that handler, and a test that mounts the page and counts the work a click does.
// A file that is already there is left as it is and reported skipped, so a scaffold run over a
// half-made project finishes it rather than overwriting it.

import { withoutTrailingSlash } from '#server/withoutTrailingSlash.ts'
import abidePackage from '../../package.json' with { type: 'json' }
import { COMPILER_OPTIONS } from './writeDefaultProject.ts'

// THE STARTER'S OWN FILES, as files: a real document, a real page and the agent notes, copied as
// they stand. What depends on the name, or what a packer drops (`filesFor`), is written here.
const STARTER = Bun.fileURLToPath(new URL('../../scaffold/', import.meta.url))

// THE ABIDE THAT WROTE THE PROJECT is the one it depends on. Installed from a registry, that is its
// version; run from a checkout, no registry has that version, and the only spelling that installs
// is the checkout's own path.
const PACKAGE_ROOT = withoutTrailingSlash(
    Bun.fileURLToPath(new URL('../../', import.meta.url)),
)
const ABIDE_DEPENDENCY = PACKAGE_ROOT.includes('/node_modules/')
    ? `^${abidePackage.version}`
    : `file:${PACKAGE_ROOT}`

// THE HARNESS BESIDE IT, by the same rule: from a registry its latest, whose peer range on abide is
// what keeps the two in step; from a checkout the checkout's own harness.
const HARNESS_DEPENDENCY = PACKAGE_ROOT.includes('/node_modules/')
    ? 'latest'
    : `file:${PACKAGE_ROOT.slice(0, PACKAGE_ROOT.lastIndexOf('/'))}/harness`

// The `#src` alias, written as the package's `imports` and again as the checker's `paths`.
const SOURCE_ALIAS = { '#src/*': ['./src/*', './src/*.ts'] }

/**
 * 38.109, 38.119 — the starter's `bunfig.toml`: the harness's abide preload, which is a DOM a test
 * can mount into and measure, then abide's own — the app's `.abide` files imported as modules, with
 * nothing booted first.
 */
export const TEST_PRELOAD =
    '# 38.109, 38.119 — a DOM to mount into and measure, then the app\'s `.abide` files as modules.\n[test]\npreload = ["@abide/harness/abide/preload"]\n'

// WRITTEN, NOT COPIED, beside the manifests: a packer drops a `bunfig.toml` or a `.gitignore` from
// the tarball (`bun pm pack` both, `npm pack` the second), so neither survives as a starter file.
function filesFor(name: string): Record<string, string> {
    return {
        'bunfig.toml': TEST_PRELOAD,
        '.gitignore': 'node_modules\n.abide\n',
        'package.json': `${JSON.stringify(
            {
                name,
                private: true,
                type: 'module',
                scripts: {
                    // 38.103 — the checker over `.abide`, which `tsc` does not read.
                    check: 'abide check',
                    dev: 'abide dev',
                    build: 'abide build',
                    start: 'abide start',
                    // 38.108 — every address, and the file answering it.
                    routes: 'abide routes',
                    // 38.112 — the starter's own test, under the 38.109 preload.
                    test: 'bun test',
                },
                // ONE ALIAS FOR THE SOURCE, and two targets for it, because an extensionless
                // specifier is how an import is written and only bun probes for the extension:
                // TypeScript takes an `imports` target as the exact file, so `#src/media/server/db`
                // alone left every name it imports `any` and the checker could not type one of
                // them (31.3). The first target is what bun resolves, and the one a `.ts` or
                // `.abide` specifier needs. Which side a module is on is its directory's to say
                // (36.10), not its alias's.
                imports: SOURCE_ALIAS,
                dependencies: { '@abide/abide': ABIDE_DEPENDENCY },
                // `Bun`, `bun:sqlite` and the rest of the runtime a server module reaches for are
                // typed by these, and `abide check` reports every one untyped without them. The
                // harness is what the starter's tests measure the work a click does with (38.119).
                devDependencies: {
                    '@abide/harness': HARNESS_DEPENDENCY,
                    '@types/bun': 'latest',
                },
            },
            null,
            4,
        )}\n`,
        'tsconfig.json': `${JSON.stringify(
            // TypeScript 7 includes no `@types` package it is not named, so the runtime's is named.
            // 34.21 — the alias as a path too: the checker resolves a text import's declaration
            // beside the file a path names, and takes an `imports` target as the exact file.
            {
                compilerOptions: {
                    ...COMPILER_OPTIONS,
                    types: ['bun'],
                    paths: SOURCE_ALIAS,
                },
                include: ['src'],
            },
            null,
            4,
        )}\n`,
        'biome.json': `${JSON.stringify(
            {
                formatter: { indentStyle: 'space', indentWidth: 4 },
                javascript: {
                    formatter: { quoteStyle: 'single', semicolons: 'asNeeded' },
                },
            },
            null,
            4,
        )}\n`,
    }
}

/** Writes the starter app into `into`, reporting which files it wrote and which it skipped. */
export async function scaffold(
    name: string,
    into: string,
): Promise<{ written: string[]; skipped: string[] }> {
    const written: string[] = []
    const skipped: string[] = []
    const files: [string, string | Blob][] = Object.entries(filesFor(name))
    for (const path of new Bun.Glob('**/*').scanSync({
        cwd: STARTER,
        dot: true,
    }))
        files.push([path, Bun.file(`${STARTER}${path}`)])
    for (const [path, contents] of files) {
        const file = Bun.file(`${into}/${path}`)
        if (await file.exists()) {
            skipped.push(path)
            continue
        }
        // READ, THEN WRITTEN. A `BunFile` handed to `Bun.write` as the source landed as an empty
        // file when the command exited straight after — the copy had not reached the disk.
        await Bun.write(
            file,
            typeof contents === 'string' ? contents : await contents.bytes(),
        )
        written.push(path)
    }
    return { written, skipped }
}
