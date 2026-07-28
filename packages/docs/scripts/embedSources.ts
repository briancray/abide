// Regenerate `src/server/EMBEDDED_SOURCES.json` — the docs site's own source, carried INSIDE an
// `abide compile` executable.
//
// This site's content IS its source: every demo card shows the running file through the `snippet` RPC,
// which reads it off disk. A standalone binary has no disk to read (its own directory is the read-only
// `/$bunfs/root` and the project was never copied to the deploy machine), so without this map exactly
// one page works — the home page, the only one with no demo card.
//
// A generated map rather than a hand-kept list because the whole point of `snippet` is that a sample is
// never a hand-copied duplicate; the same must hold for the compiled copy. Run by `bun run compile`
// before `abide compile`, so the embedded text is always the text of the build that carries it — and
// only ever a FALLBACK: `abide dev`/`start` still read the live file, so editing a demo shows up
// immediately with no regeneration.

import { join, relative } from 'node:path'

const DOCS_ROOT = join(import.meta.dir, '..')
const OUTPUT = join(DOCS_ROOT, 'src/server/EMBEDDED_SOURCES.json')

// What a demo card can ask for: the authored source kinds. `src/.abide/**` is generated type output and
// the map itself is generated — including either would embed a build artifact, and the map would grow
// by its own size on every run.
const SOURCE_PATTERN = '**/*.{ts,abide,css}'
const EXCLUDED_PREFIX = '.abide/'

const sources: Record<string, string> = {}
const glob = new Bun.Glob(SOURCE_PATTERN)
const srcDir = join(DOCS_ROOT, 'src')
const found: string[] = []
for await (const relativePath of glob.scan({ cwd: srcDir, onlyFiles: true })) {
    if (relativePath.startsWith(EXCLUDED_PREFIX)) continue
    found.push(relativePath)
}
// Sorted so the file is byte-stable across runs and machines — a regenerated map with the same content
// must produce no diff.
found.sort()
for (const relativePath of found) {
    const absolute = join(srcDir, relativePath)
    if (absolute === OUTPUT) continue
    sources[relative(DOCS_ROOT, absolute)] = await Bun.file(absolute).text()
}

// One key per line: a source edit then shows up as ONE changed line in review, not as a rewritten blob.
await Bun.write(OUTPUT, `${JSON.stringify(sources, null, 1)}\n`)
console.info(
    `embedSources — ${Object.keys(sources).length} files, ${((await Bun.file(OUTPUT).size) / 1024).toFixed(0)} KB → ${relative(DOCS_ROOT, OUTPUT)}`,
)
