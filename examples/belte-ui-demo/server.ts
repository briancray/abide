import { resolve } from 'node:path'
import type { BunPlugin } from 'bun'
import { belteUiPlugin } from '../../packages/belte/src/lib/ui/compile/belteUiPlugin.ts'
import { compileSSR } from '../../packages/belte/src/lib/ui/compile/compileSSR.ts'
import { derived } from '../../packages/belte/src/lib/ui/derived.ts'
import { doc } from '../../packages/belte/src/lib/ui/doc.ts'
import { effect } from '../../packages/belte/src/lib/ui/effect.ts'
import { renderToStream } from '../../packages/belte/src/lib/ui/renderToStream.ts'
import type { SsrRender } from '../../packages/belte/src/lib/ui/runtime/types/SsrRender.ts'
import { state } from '../../packages/belte/src/lib/ui/state.ts'

/*
A real multi-page belte-ui app, end to end through the actual pipeline:

  - one CLIENT bundle (all pages + router) built by `Bun.build` + `belteUiPlugin`,
    with a resolver mapping the emitted `belte/ui/*` imports to source;
  - regular routes are server-rendered complete; `/data` is STREAMED via
    `renderToStream` — the pending shell flushes first, then the resolved fragment
    when its promise settles, swapped into place by a tiny inline script.

In a published app these would be `belte build` / `belte start`.
*/

const UI_SRC = resolve(import.meta.dir, '../../packages/belte/src/lib/ui')
const PAGES: Record<string, string> = {
    '/': 'Home.belte',
    '/about': 'About.belte',
    '/form': 'Form.belte',
    '/data': 'Data.belte',
}

const belteUiResolver: BunPlugin = {
    name: 'belte-ui-resolve',
    setup(build) {
        build.onResolve({ filter: /^belte\/ui\// }, (args) => ({
            path: `${resolve(UI_SRC, args.path.replace(/^belte\/ui\//, ''))}.ts`,
        }))
    },
}

/* Vanilla browser swap: moves each streamed `<belte-resolve>` fragment into its
   `<!--belte:await:id-->` boundary. Inlined in streamed responses, run after each
   fragment so the value appears as soon as it arrives — even before the bundle. */
const SWAP_SCRIPT =
    "function __belteSwap(){var f=document.querySelector('belte-resolve');while(f){" +
    "var id=f.getAttribute('data-id'),w=document.createTreeWalker(document.body,NodeFilter.SHOW_COMMENT),o=null,c;" +
    "while((c=w.nextNode())){if(c.data==='belte:await:'+id){o=c;break;}}" +
    "if(o){var n=o.nextSibling;while(n&&!(n.nodeType===8&&n.data==='/belte:await:'+id)){var x=n.nextSibling;n.remove();n=x;}" +
    "while(f.firstChild){o.parentNode.insertBefore(f.firstChild,n);}}f.remove();f=document.querySelector('belte-resolve');}}"

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

/* A server `render()` for a page source. */
function compileRender(source: string): () => SsrRender {
    const body = compileSSR(source)
    return () =>
        new Function('doc', 'state', 'derived', 'effect', body)(
            doc,
            state,
            derived,
            effect,
        ) as SsrRender
}

async function pageSource(path: string): Promise<string> {
    return Bun.file(resolve(import.meta.dir, PAGES[path] ?? PAGES['/'])).text()
}

/* Complete (non-streamed) server render of a route's HTML. */
export async function renderShell(path = '/'): Promise<string> {
    return compileRender(await pageSource(path))().html
}

function document(shell: string, clientJs: string, head = ''): string {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>belte-ui demo</title>${head}</head><body><div id="app">${shell}</div><script type="module">${clientJs}</script></body></html>`
}

/* A streamed response: pending shell first, then resolved fragments + swap. */
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
    const clientJs = await buildClient()
    return Bun.serve({
        port,
        async fetch(request) {
            const path = new URL(request.url).pathname
            if (!(path in PAGES)) {
                return new Response('not found', { status: 404 })
            }
            if (path === '/data') {
                return streamResponse(compileRender(await pageSource(path)), clientJs)
            }
            return new Response(document(await renderShell(path), clientJs), {
                headers: { 'content-type': 'text/html; charset=utf-8' },
            })
        },
    })
}

if (import.meta.main) {
    const server = await serve()
    console.log(`belte-ui demo running at ${server.url}`)
}
