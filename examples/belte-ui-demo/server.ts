import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { BunPlugin } from 'bun'
import { belteUiPlugin } from '../../packages/belte/src/lib/ui/compile/belteUiPlugin.ts'
import { renderToStream } from '../../packages/belte/src/lib/ui/renderToStream.ts'
import type { SsrRender } from '../../packages/belte/src/lib/ui/runtime/types/SsrRender.ts'

/*
A real multi-page belte-ui app, end to end through the actual pipeline:

  - ONE client bundle (all pages, the shared Layout, slots, the router) built by
    `Bun.build` + `belteUiPlugin`;
  - SSR is also a real build — a server bundle of the page modules, imported and
    rendered (so nested components + slots resolve through the bundler, not a
    single-component shim);
  - regular routes render complete; `/data` STREAMS via `renderToStream` (pending
    shell, then the resolved fragment swapped in by a tiny inline script).

In a published app these would be `belte build` / `belte start`.
*/

const LIB_SRC = resolve(import.meta.dir, '../../packages/belte/src/lib')
const PAGES: Record<string, string> = {
    '/': 'Home.belte',
    '/about': 'About.belte',
    '/form': 'Form.belte',
    '/data': 'Data.belte',
}

/* Maps the `@belte/belte/ui/*` and `@belte/belte/shared/*` specifiers compiled
   components emit (and the bare `belte/ui/*` this demo's own files use) to the
   framework source — a published app resolves them through `@belte/belte`'s
   package exports instead. */
const belteUiResolver: BunPlugin = {
    name: 'belte-ui-resolve',
    setup(build) {
        build.onResolve({ filter: /^(@belte\/belte|belte)\/(ui|shared)\// }, (args) => ({
            path: `${resolve(LIB_SRC, args.path.replace(/^(@belte\/belte|belte)\//, ''))}.ts`,
        }))
    },
}

const SWAP_SCRIPT =
    "function __belteSwap(){var f=document.querySelector('belte-resolve');while(f){" +
    "var id=f.getAttribute('data-id'),w=document.createTreeWalker(document.body,NodeFilter.SHOW_COMMENT),o=null,c;" +
    "try{(window.__belteResume=window.__belteResume||{})[id]=JSON.parse(f.getAttribute('data-resume')||'null');}catch(e){}" +
    "while((c=w.nextNode())){if(c.data==='belte:await:'+id){o=c;break;}}" +
    "if(o){var n=o.nextSibling;while(n&&!(n.nodeType===8&&n.data==='/belte:await:'+id)){var x=n.nextSibling;n.remove();n=x;}" +
    "while(f.firstChild){o.parentNode.insertBefore(f.firstChild,n);}}f.remove();f=document.querySelector('belte-resolve');}}"

/* A page's default export: a client mounter with a `.render($props)` for SSR. */
type Page = ((host: Element, props?: unknown) => void) & { render: (props?: unknown) => SsrRender }

/* Bundles an entry through Bun.build + the loaders, writes it beside the example
   (Bun won't dynamically import from outside the project tree), imports it, then
   removes the temp files. */
async function buildAndImport(
    entrySource: string,
    label: string,
): Promise<Record<string, unknown>> {
    const stamp = Date.now()
    const entryPath = resolve(import.meta.dir, `.belte-${label}-entry-${stamp}.ts`)
    const bundlePath = resolve(import.meta.dir, `.belte-${label}-bundle-${stamp}.js`)
    await Bun.write(entryPath, entrySource)
    try {
        const built = await Bun.build({
            entrypoints: [entryPath],
            plugins: [belteUiPlugin, belteUiResolver],
            target: 'bun',
        })
        if (!built.success) {
            throw new AggregateError(built.logs, `belte-ui demo: ${label} build failed`)
        }
        await Bun.write(bundlePath, await built.outputs[0].text())
        return await import(pathToFileURL(bundlePath).href)
    } finally {
        rmSync(entryPath, { force: true })
        rmSync(bundlePath, { force: true })
    }
}

/* Server bundle: the page modules, rendered server-side. */
async function buildRoutes(): Promise<Record<string, Page>> {
    const imports = Object.values(PAGES)
        .map(
            (file, index) =>
                `import P${index} from ${JSON.stringify(resolve(import.meta.dir, file))}`,
        )
        .join('\n')
    const registry = Object.keys(PAGES)
        .map((path, index) => `${JSON.stringify(path)}: P${index}`)
        .join(', ')
    const module = await buildAndImport(
        `${imports}\nexport const routes = { ${registry} }`,
        'server',
    )
    return module.routes as Record<string, Page>
}

/* Client bundle: the browser entry (router + all pages). */
export async function buildClient(): Promise<string> {
    const built = await Bun.build({
        entrypoints: [resolve(import.meta.dir, 'main.ts')],
        plugins: [belteUiPlugin, belteUiResolver],
        target: 'browser',
    })
    if (!built.success) {
        throw new AggregateError(built.logs, 'belte-ui demo: client build failed')
    }
    return built.outputs[0].text()
}

function html(shell: string, clientJs: string): string {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>belte-ui demo</title></head><body><div id="app">${shell}</div><script type="module">${clientJs}</script></body></html>`
}

function streamResponse(render: () => SsrRender, clientJs: string): Response {
    const encoder = new TextEncoder()
    return new Response(
        new ReadableStream({
            async start(controller) {
                let first = true
                for await (const chunk of renderToStream(render)) {
                    if (first) {
                        controller.enqueue(
                            encoder.encode(
                                `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>belte-ui demo</title><script>${SWAP_SCRIPT}</script></head><body><div id="app">${chunk}</div>`,
                            ),
                        )
                        first = false
                    } else {
                        controller.enqueue(encoder.encode(`${chunk}<script>__belteSwap()</script>`))
                    }
                }
                controller.enqueue(
                    encoder.encode(`<script type="module">${clientJs}</script></body></html>`),
                )
                controller.close()
            },
        }),
        { headers: { 'content-type': 'text/html; charset=utf-8' } },
    )
}

export async function serve(port = 3737) {
    const [clientJs, routes] = await Promise.all([buildClient(), buildRoutes()])
    /* Exposed for the verifier. */
    serve.routes = routes
    return Bun.serve({
        port,
        async fetch(request) {
            const url = new URL(request.url)
            if (url.pathname === '/api/users') {
                await new Promise((resolve) => setTimeout(resolve, 60))
                return Response.json(['ada', 'grace', 'linus', 'margaret'])
            }
            const page = routes[url.pathname]
            if (page === undefined) {
                return new Response('not found', { status: 404 })
            }
            if (url.pathname === '/data') {
                ;(globalThis as { BELTE_ORIGIN?: string }).BELTE_ORIGIN = url.origin
                return streamResponse(() => page.render({}), clientJs)
            }
            return new Response(html(page.render({}).html, clientJs), {
                headers: { 'content-type': 'text/html; charset=utf-8' },
            })
        },
    })
}
serve.routes = {} as Record<string, Page>

if (import.meta.main) {
    const server = await serve()
    console.log(`belte-ui demo running at ${server.url}`)
}
