#!/usr/bin/env bun
/*
Biome can't target `.abide` files: it picks a language by hardcoded extension and
has no config to map a custom one to a parser (unlike Prettier's `overrides`). So
Biome never sees the TypeScript inside a component's `<script>`.

This bridges the gap. For every `.abide` it slices out the leading `<script>`
(the component script — the same block the compiler extracts in analyzeComponent),
feeds the body to `biome check` over stdin under a `.ts` path so Biome treats it as
TypeScript, and splices the formatted result back between the original tags. The
template and `<style>` are left untouched — Biome has no parser for them.

Linting is off (mirrors the repo's `format` script): the abide reactive primitives
(`state`/`derived`/`effect`/…) are ambient globals, so a standalone-module lint
would flag them as undeclared. Assist (organize-imports) still runs.
*/
import { Glob } from 'bun'

// The leading `<script …>BODY</script>`; only the first one is the component
// script (nested `<script>`s are scoped reactive blocks the compiler handles).
const LEADING_SCRIPT = /^(\s*)<script([^>]*)>([\s\S]*?)<\/script>/

/* Formats one script body as TypeScript through Biome, returning its stdout. The
   `.ts` stdin path is what makes Biome parse it; failure leaves the file untouched. */
async function formatScript(body: string): Promise<string | undefined> {
    const biome = Bun.spawn(
        [
            'bunx',
            'biome',
            'check',
            '--write',
            '--linter-enabled=false',
            '--stdin-file-path=script.ts',
        ],
        { stdin: new TextEncoder().encode(body), stdout: 'pipe', stderr: 'pipe' },
    )
    const formatted = await new Response(biome.stdout).text()
    return (await biome.exited) === 0 ? formatted : undefined
}

/* Reformats a single `.abide` in place, returning whether its bytes changed. */
async function formatFile(path: string): Promise<boolean> {
    const source = await Bun.file(path).text()
    const match = source.match(LEADING_SCRIPT)
    if (match === null) {
        return false
    }
    const [whole, leading, attrs, body] = match
    const formatted = await formatScript(body)
    if (formatted === undefined) {
        return false
    }
    // Reconstruct with the original tags; the body sits at column 0 (abide
    // convention, matching Biome's output) framed by single newlines.
    const rebuilt = `${leading}<script${attrs}>\n${formatted.trim()}\n</script>`
    const next = rebuilt + source.slice(whole.length)
    if (next === source) {
        return false
    }
    await Bun.write(path, next)
    return true
}

const files = (await Array.fromAsync(new Glob('**/*.abide').scan('.'))).filter(
    (path) => !path.includes('node_modules'),
)
const changed = await Promise.all(files.map(formatFile))
const count = changed.filter(Boolean).length
console.log(`formatAbide: ${count} of ${files.length} .abide file(s) reformatted`)
