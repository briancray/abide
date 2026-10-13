// 38.1 — `abide scaffold <name>`: THE LAYOUT EVERY ABIDE APP HAS, written into `<name>`. There is
// nothing to choose, because what is scaffolded is a route, the shell and the hooks — the files the
// commands read.
// A file that is already there is left as it is and reported skipped, so a scaffold run over a
// half-made project finishes it rather than overwriting it.

import { withoutTrailingSlash } from '#server/withoutTrailingSlash.ts'
import abidePackage from '../../package.json' with { type: 'json' }
import { COMPILER_OPTIONS } from './writeDefaultProject.ts'

// THE STARTER'S OWN FILES, as files: a real document, a real page and a real module, copied as they
// stand. What depends on the name — the manifests — is written here.
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

function filesFor(name: string): Record<string, string> {
    return {
        'package.json': `${JSON.stringify(
            {
                name,
                private: true,
                type: 'module',
                // 34.24 — `prepare` runs on `bun install`, so a `.ts` importing a `.abide` is typed
                // before any other abide command has run; and never fails it, as it would where
                // `package.json` is installed before `src` is there to sync (38.26).
                scripts: {
                    prepare: 'abide sync || true',
                    // 38.103 — the checker over `.abide`, which `tsc` does not read.
                    check: 'abide check',
                    dev: 'abide dev',
                    build: 'abide build',
                    start: 'abide start',
                },
                // ONE ALIAS FOR THE SOURCE, and two targets for it, because an extensionless
                // specifier is how an import is written and only bun probes for the extension:
                // TypeScript takes an `imports` target as the exact file, so `#src/media/server/db`
                // alone left every name it imports `any` and the checker could not type one of
                // them (31.3). The first target is what bun resolves, and the one a `.ts` or
                // `.abide` specifier needs. Which side a module is on is its directory's to say
                // (36.10), not its alias's.
                imports: {
                    '#src/*': ['./src/*', './src/*.ts'],
                },
                dependencies: { '@abide/abide': ABIDE_DEPENDENCY },
                // `Bun`, `bun:sqlite` and the rest of the runtime a server module reaches for are
                // typed by these, and `abide check` reports every one untyped without them.
                devDependencies: { '@types/bun': 'latest' },
            },
            null,
            4,
        )}\n`,
        'tsconfig.json': `${JSON.stringify(
            // TypeScript 7 includes no `@types` package it is not named, so the runtime's is named.
            // 34.24 — `rootDirs` and the `#src/*` path reach what abide writes to `.abide/types`,
            // where a `.ts` importing a `.abide` finds the names it exports.
            {
                compilerOptions: {
                    ...COMPILER_OPTIONS,
                    types: ['bun'],
                    rootDirs: ['.', '.abide/types'],
                    paths: {
                        '#src/*': [
                            './src/*',
                            './src/*.ts',
                            './.abide/types/src/*',
                        ],
                    },
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
