// 38.119 — `mount` from `@abide/abide/test`: a component an app's test imported and bound, rendered
// into the document's body as the server writes it and hydrated there by its browser module — the
// same two halves a page load runs, in one process, so a test can click it and read the work.

import { flushSync } from '#shared/reactive/Reactive.ts'

import { MOUNTABLE } from './MOUNTABLE.ts'
import { type Component, render } from './render.ts'

type Mountable = {
    accessors: Record<string, () => unknown>
    client: () => Promise<{
        default: (
            region: unknown,
            props: Record<string, () => unknown>,
        ) => { stop(): void } | undefined
    }>
}

/** A mounted component: `stop` ends every watch its hydration opened. */
export type Mounted = { stop(): void; [Symbol.dispose](): void }

/**
 * Renders `component` into `document.body` and hydrates it there, with every effect its mount woke
 * already run.
 */
export async function mount(component: Component): Promise<Mounted> {
    const mountable = (component as Record<symbol, Mountable | undefined>)[
        MOUNTABLE
    ]
    if (mountable === undefined)
        throw new Error(
            'abide: mount takes a component a test imported from a `.abide` and bound — `mount(Counter({ start: 2 }))`. RULEBOOK 38.119.',
        )
    if (typeof document === 'undefined')
        throw new Error(
            'abide: mount renders into a DOM, and this process has none. Preload `@abide/harness/preload` ahead of `@abide/abide/test` in bunfig.toml. RULEBOOK 38.119.',
        )
    const html = new TextDecoder().decode(await render(component))
    // After the `<body …>` open tag, whatever attributes the component wrote onto it (35.15).
    document.body.innerHTML = html.slice(
        html.indexOf('>', html.indexOf('<body')) + 1,
        html.indexOf('</body>'),
    )
    // LOADED HERE, not at the top: the preload this module is part of runs in processes with no DOM.
    const [{ default: hydrate }, { pageRegion }] = await Promise.all([
        mountable.client(),
        import('#ui/regions.ts'),
    ])
    const scope = hydrate(pageRegion(document.body), mountable.accessors)
    flushSync()
    const stop = (): void => scope?.stop()
    return { stop, [Symbol.dispose]: stop }
}
