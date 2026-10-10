// 38.1 — `abide scaffold <name>`: THE LAYOUT EVERY ABIDE APP HAS, written into `<name>`. There is
// nothing to choose, because what is scaffolded is the three seams and the files the commands read.
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
                scripts: {
                    dev: 'abide dev',
                    build: 'abide build',
                    start: 'abide start',
                },
                // TWO TARGETS A SEAM, because an extensionless specifier is how the seams are
                // written and only bun probes for the extension: TypeScript takes an `imports`
                // target as the exact file, so `#server/database` alone left every name it
                // imports `any` and the checker could not type one of them (31.3). The first
                // target is what bun resolves, and the one a `.ts` or `.abide` specifier needs.
                imports: {
                    '#ui/*': ['./src/ui/*', './src/ui/*.ts'],
                    '#server/*': ['./src/server/*', './src/server/*.ts'],
                    '#shared/*': ['./src/shared/*', './src/shared/*.ts'],
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
            {
                compilerOptions: { ...COMPILER_OPTIONS, types: ['bun'] },
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
    // The seam both sides import from is there from the first commit, `.gitkeep` and all.
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
