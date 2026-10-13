// HOW A SPEC OVER AN ARM DRIVES IT — the page mounted into happy-dom, the routes its `Bun.serve`
// was handed, and the reads, clicks and keystrokes the cards' claims are stated in. Shared by
// `arms.test.ts` and the `arms*.test.ts` files beside it, which split the arms by the docs they
// stand behind so the parallel gate can run them side by side.
export const ARMS_DIR = new URL('../arms/', import.meta.url)

// The `<script src>` is dropped rather than resolved: happy-dom declines to load one, and the
// module is imported below anyway. A cache-buster on the specifier so two tests over one arm
// each get a fresh module scope, the arms being top-level scripts rather than exports.
export async function mount(name: string, script: string): Promise<void> {
    const markup = await Bun.file(
        new URL(`${name}/index.html`, ARMS_DIR),
    ).text()
    document.body.innerHTML = markup.replace(/<script[^>]*><\/script>/, '')
    await import(
        `${new URL(`${name}/${script}`, ARMS_DIR).pathname}?${Math.random()}`
    )
}

// AN ARM THAT SERVES ITSELF answers from routes rather than from a fixture, so a spec over one
// captures them the way the frame does: `Bun.serve` is stubbed and the file is imported for the
// call it makes at the top level.
export type Routes = Record<
    string,
    (request: Request) => Response | Promise<Response>
>

export async function routesOf(name: string, file: string): Promise<Routes> {
    let captured: Routes = {}
    const serve = Bun.serve
    ;(Bun as { serve: unknown }).serve = (options: { routes?: Routes }) => {
        captured = options.routes ?? {}
    }
    try {
        await import(
            `${new URL(`${name}/${file}`, ARMS_DIR).pathname}?${Math.random()}`
        )
    } finally {
        Bun.serve = serve
    }
    return captured
}

export function read(id: string): string {
    return document.querySelector(id)?.textContent ?? ''
}

export function click(id: string): void {
    ;(document.querySelector(id) as HTMLElement).click()
}

export function type(id: string, value: string): void {
    const field = document.querySelector(id) as HTMLInputElement
    field.value = value
    field.dispatchEvent(new Event('input'))
}

// A stream whose gap between rows the caller sets, so one spec can hold a report that takes
// LONGER than the bound and never goes quiet for it, against one that goes quiet at once.
export function streamingFetch(
    rows: Record<string, string[]>,
    step: number,
): typeof fetch {
    return Object.assign(
        async (input: string, init?: RequestInit) => {
            const region =
                new URL(input, 'http://example.invalid').searchParams.get(
                    'region',
                ) ?? ''
            const lines = rows[region] ?? []
            const encoder = new TextEncoder()
            let at = 0
            return new Response(
                new ReadableStream({
                    // THE ABORT HAS TO REACH THE READER, and registering it per branch is
                    // how this stopped testing anything: the parked branch honored the
                    // signal and the producing one did not, so a wall-clock timer passed.
                    start(controller) {
                        init?.signal?.addEventListener('abort', () => {
                            try {
                                controller.error(new Error('aborted'))
                            } catch {}
                        })
                    },
                    async pull(controller) {
                        if (at === lines.length) {
                            if (lines.length > 0) return controller.close()
                            // The upstream that has stopped: no row, and no close either.
                            return new Promise(() => {})
                        }
                        await Bun.sleep(step)
                        if (init?.signal?.aborted) return
                        controller.enqueue(encoder.encode(`${lines[at]}\n`))
                        at += 1
                    },
                }),
            )
        },
        { preconnect: () => {} },
    ) as typeof fetch
}
