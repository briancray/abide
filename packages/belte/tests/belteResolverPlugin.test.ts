import { afterAll, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { belteResolverPlugin } from '../src/belteResolverPlugin.ts'

const roots: string[] = []
afterAll(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })))

// Creates a temp project dir, runs `build` to lay out files, returns the dir.
function tempProject(build: (dir: string) => void): string {
    const dir = mkdtempSync(`${tmpdir()}/belte-resolver-`)
    roots.push(dir)
    build(dir)
    return dir
}

/*
Builds a one-file stylesheet through the resolver plugin and returns the
emitted CSS. `extraFiles` lays down any sibling assets a relative url() needs.
Asserts the build succeeded so each test reads as a happy path.
*/
async function buildCss(css: string, extraFiles: Record<string, string> = {}): Promise<string> {
    const cwd = tempProject((root) => {
        mkdirSync(root, { recursive: true })
        writeFileSync(`${root}/app.css`, css)
        writeFileSync(`${root}/entry.ts`, 'import "./app.css"\n')
        for (const [name, contents] of Object.entries(extraFiles)) {
            writeFileSync(`${root}/${name}`, contents)
        }
    })
    const result = await Bun.build({
        entrypoints: [`${cwd}/entry.ts`],
        outdir: `${cwd}/out`,
        target: 'browser',
        plugins: [belteResolverPlugin({ cwd, target: 'client' })],
    })
    expect(result.success).toBe(true)
    return (await result.outputs.find((output) => output.path.endsWith('.css'))?.text()) ?? ''
}

/*
Regression: a root-absolute url() in a stylesheet (a public asset served at
the site root at runtime) must not fail the build. The resolver marks it
external so the literal `/…` path survives into the emitted CSS.
*/
test('leaves root-absolute url() in CSS external instead of resolving it', async () => {
    const cwd = tempProject((root) => {
        mkdirSync(root, { recursive: true })
        writeFileSync(
            `${root}/app.css`,
            '@font-face { font-family: "F"; src: url(/fonts/f.woff2) format("woff2"); }\n' +
                '.bg { background: url(/images/bar.png); }\n',
        )
        writeFileSync(`${root}/entry.ts`, 'import "./app.css"\n')
    })

    const result = await Bun.build({
        entrypoints: [`${cwd}/entry.ts`],
        outdir: `${cwd}/out`,
        target: 'browser',
        plugins: [belteResolverPlugin({ cwd, target: 'client' })],
    })

    expect(result.success).toBe(true)
    const css = await result.outputs.find((output) => output.path.endsWith('.css'))?.text()
    // Literal site-root paths are preserved for the runtime public asset server.
    expect(css).toContain('url("/fonts/f.woff2")')
    expect(css).toContain('url("/images/bar.png")')
})

/*
The external rule is scoped to .css importers so it can't shadow belte's own
absolute-path imports. A relative url() is a genuine build-time asset and must
still resolve and bundle.
*/
test('still resolves relative url() in CSS as a bundled asset', async () => {
    const cwd = tempProject((root) => {
        mkdirSync(root, { recursive: true })
        writeFileSync(`${root}/dot.png`, 'x')
        writeFileSync(`${root}/app.css`, '.bg { background: url(./dot.png); }\n')
        writeFileSync(`${root}/entry.ts`, 'import "./app.css"\n')
    })

    const result = await Bun.build({
        entrypoints: [`${cwd}/entry.ts`],
        outdir: `${cwd}/out`,
        target: 'browser',
        plugins: [belteResolverPlugin({ cwd, target: 'client' })],
    })

    expect(result.success).toBe(true)
    const css = await result.outputs.find((output) => output.path.endsWith('.css'))?.text()
    // Resolved by the bundler — inlined as a data URI (or hashed when large),
    // never left as the original relative specifier.
    expect(css).not.toContain('./dot.png')
    expect(css).toMatch(/url\("(data:|\.?\/?dot-)[^"]+"\)/)
})

// Nested site-root paths survive verbatim — public/ mirrors the URL tree.
test('preserves a deep root-absolute url() path', async () => {
    const css = await buildCss('.bg { background: url(/assets/img/hero.png); }\n')
    expect(css).toContain('url("/assets/img/hero.png")')
})

// Quote style is the author's choice; the path must survive regardless.
test('preserves root-absolute url() written single-quoted or unquoted', async () => {
    const css = await buildCss(
        ".a { background: url('/q/single.png'); }\n.b { background: url(/q/bare.png); }\n",
    )
    expect(css).toContain('url("/q/single.png")')
    expect(css).toContain('url("/q/bare.png")')
})

// A realistic @font-face with several formats — every src entry is site-root.
test('preserves every src in a multi-format @font-face', async () => {
    const css = await buildCss(
        '@font-face {\n' +
            '  font-family: "Inter";\n' +
            '  src: url(/fonts/inter.woff2) format("woff2"),\n' +
            '       url(/fonts/inter.woff) format("woff");\n' +
            '}\n',
    )
    expect(css).toContain('url("/fonts/inter.woff2")')
    expect(css).toContain('url("/fonts/inter.woff")')
})

/*
The common real-world stylesheet: a root-absolute font (runtime public asset)
sitting beside a relative decoration (build-time asset). The font stays
external; the relative one resolves.
*/
test('handles a mix of root-absolute and relative url() in one sheet', async () => {
    const css = await buildCss(
        '@font-face { font-family: "F"; src: url(/fonts/f.woff2); }\n' +
            '.icon { background: url(./icon.png); }\n',
        { 'icon.png': 'x' },
    )
    expect(css).toContain('url("/fonts/f.woff2")')
    expect(css).not.toContain('./icon.png')
    expect(css).toMatch(/url\("(data:|\.?\/?icon-)[^"]+"\)/)
})

// External absolute URLs are already left alone by Bun; the rule mustn't disturb them.
test('leaves absolute http(s) and data url() untouched', async () => {
    const css = await buildCss(
        '.a { background: url(https://cdn.example.com/x.png); }\n' +
            '.b { background: url(data:image/gif;base64,R0lGOD); }\n',
    )
    expect(css).toContain('url("https://cdn.example.com/x.png")')
    expect(css).toContain('url("data:image/gif;base64,R0lGOD")')
})

// The plugin is constructed per target; the server build must externalize too.
test('externalizes root-absolute url() for the server target', async () => {
    const cwd = tempProject((root) => {
        mkdirSync(root, { recursive: true })
        writeFileSync(`${root}/app.css`, '.bg { background: url(/images/server.png); }\n')
        writeFileSync(`${root}/entry.ts`, 'import "./app.css"\n')
    })
    const result = await Bun.build({
        entrypoints: [`${cwd}/entry.ts`],
        outdir: `${cwd}/out`,
        target: 'browser',
        plugins: [belteResolverPlugin({ cwd, target: 'server' })],
    })
    expect(result.success).toBe(true)
    const css = await result.outputs.find((output) => output.path.endsWith('.css'))?.text()
    expect(css).toContain('url("/images/server.png")')
})
