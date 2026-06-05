import type { BunPlugin } from 'bun'
import { belteResolverPlugin } from './belteResolverPlugin.ts'
import { dedupeSveltePlugin } from './dedupeSveltePlugin.ts'
import { exitOnBuildFailure } from './lib/shared/exitOnBuildFailure.ts'
import { isModuleNotFound } from './lib/shared/isModuleNotFound.ts'
import { log } from './lib/shared/log.ts'
import type { SvelteConfig } from './lib/shared/types/SvelteConfig.ts'
import { sveltePlugin } from './sveltePlugin.ts'

const ENTRY = new URL('./bundleDisconnectedEntry.ts', import.meta.url).pathname
const CSS_ENTRY = new URL('./lib/bundle/disconnected.css', import.meta.url).pathname

/*
Default screen logo: a minimal inline-SVG belte mark, used when the project ships
no src/bundle/logo.png. Inline SVG keeps the bundle self-contained with no asset
file to vendor; a project overrides it just by adding the PNG.
*/
const DEFAULT_LOGO = `data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
        '<rect width="64" height="64" rx="16" fill="#111827"/>' +
        '<text x="32" y="45" font-family="system-ui,sans-serif" font-size="38" ' +
        'font-weight="700" fill="#fff" text-anchor="middle">b</text></svg>',
)}`

/*
Builds the bundle connect screen into a single self-contained HTML string and
writes it to `dist/bundle-disconnected.html`, which the launcher bakes in via the
`belte:bundle-disconnected` virtual. The client bundle (Svelte component +
injected CSS + compiled Tailwind) is inlined into the page so the launcher serves
it with zero external requests; the logo is embedded as a data URI. The app title
(`window.__BELTE_TITLE__`) is injected by the launcher at serve time, so a
`<!--belte:connect-config-->` marker is left in <head> for it.

Must run after the client build has cleared and repopulated dist (it writes a
file into dist), and before the launcher build that reads it. Uses no outdir of
its own — Bun.build artifacts are read from memory — so it never touches dist
beyond the one file it writes.
*/
export async function buildDisconnected({
    cwd = process.cwd(),
    svelteConfig,
}: {
    cwd?: string
    svelteConfig?: SvelteConfig
} = {}): Promise<string> {
    const plugins: BunPlugin[] = [
        dedupeSveltePlugin({ cwd, conditions: ['browser', 'default'] }),
        sveltePlugin({ generate: 'client', svelteConfig }),
        belteResolverPlugin({ cwd, target: 'client' }),
    ]
    try {
        const tailwind = (await import('bun-plugin-tailwind')).default
        plugins.push(tailwind)
    } catch (error) {
        // Optional peer: swallow "not installed", surface any real load error.
        if (!isModuleNotFound(error)) {
            throw error
        }
        log.warn('bun-plugin-tailwind not installed; building connect screen without Tailwind')
    }

    /*
    The Tailwind CSS rides as its own entrypoint rather than a `.css` import from
    the entry (which TS can't type), so it compiles to a standalone artifact we
    inline alongside the JS — the component carries no <style> of its own.
    */
    const result = await Bun.build({
        entrypoints: [ENTRY, CSS_ENTRY],
        target: 'browser',
        minify: true,
        plugins,
    })
    exitOnBuildFailure(result)

    // Collect the JS bundle + extracted CSS from the in-memory artifacts.
    let js = ''
    let css = ''
    for (const output of result.outputs) {
        const text = await output.text()
        if (output.path.endsWith('.css')) {
            css += text
        } else if (output.path.endsWith('.js')) {
            js += text
        }
    }

    const logo = await readLogo(cwd)
    const html = composeHtml({ js, css, logo })
    const outPath = `${cwd}/dist/bundle-disconnected.html`
    await Bun.write(outPath, html)
    log.success(`built connect screen: ${outPath} (${(html.length / 1024).toFixed(1)} KiB)`)
    return outPath
}

// Reads the project's src/bundle/logo.png as a data URI, or the default mark.
async function readLogo(cwd: string): Promise<string> {
    const userLogo = Bun.file(`${cwd}/src/bundle/logo.png`)
    if (await userLogo.exists()) {
        const bytes = await userLogo.bytes()
        return `data:image/png;base64,${bytes.toBase64()}`
    }
    return DEFAULT_LOGO
}

/*
Escapes a closing `</script>` so an inline `<script>` body can't be terminated
early by content in the bundle (rare, but a `</script>` substring would break the
page). The browser still parses `<\/script>` as the intended characters.
*/
function escapeScriptBody(value: string): string {
    return value.replace(/<\/(script)/gi, '<\\/$1')
}

// Assembles the final standalone HTML document from the inlined pieces.
function composeHtml({ js, css, logo }: { js: string; css: string; logo: string }): string {
    const logoScript = `window.__BELTE_LOGO__=${JSON.stringify(logo)}`
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<!--belte:connect-config-->
<script>${escapeScriptBody(logoScript)}</script>
<!-- Paint the screen background before the client mounts, so there's no white
flash ahead of the splash (gray-50 / gray-950 to match the rendered screen). -->
<style>html,body{margin:0;background:#f9fafb}@media (prefers-color-scheme:dark){html,body{background:#030712}}</style>
<style>${css}</style>
</head>
<body>
<div id="app"></div>
<script type="module">${escapeScriptBody(js)}</script>
</body>
</html>
`
}
