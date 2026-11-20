// 38.119 — `mount` from `@abide/abide/test`: a component an app's test imported and bound, rendered
// into the document's body as the server writes it and hydrated there by its browser module — the
// same two halves a page load runs, in one process, so a test can click it and read the work.
//
// AFTER WHAT THE BODY HOLDS, not over it: two components a test mounts together — a toast and the
// list that shows it — each keep the markup their watches write to, and each one's stop takes away
// what it added.

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

/** A mounted component: `stop` ends every watch its hydration opened, and removes its markup. */
export type Mounted = { stop(): void; [Symbol.dispose](): void }

/**
 * Renders `component` at the end of `document.body` and hydrates it there, with every effect its
 * mount woke already run.
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
    // 12.5 — the server pass's watches stop once its document is written, as any render's do.
    const html = new TextDecoder().decode(await render(component))
    // After the `<body …>` open tag, whatever attributes the component wrote onto it (35.15).
    const markup = document.createElement('template')
    markup.innerHTML = html.slice(
        html.indexOf('>', html.indexOf('<body')) + 1,
        html.indexOf('</body>'),
    )
    const added = [...markup.content.childNodes]
    document.body.append(markup.content)
    // LOADED HERE, not at the top: the preload this module is part of runs in processes with no DOM.
    const [{ default: hydrate }, { pageRegion, removeUntil }] =
        await Promise.all([mountable.client(), import('#ui/regions.ts')])
    const region = pageRegion(document.body, added[0] ?? null)
    const scope = hydrate(region, mountable.accessors)
    flushSync()
    let stopped = false
    const stop = (): void => {
        if (stopped) return
        stopped = true
        scope?.stop()
        // What hydration put between the anchors is not what was added, so the region goes by them.
        removeUntil(region.open, region.close.nextSibling)
        for (const node of added) node.parentNode?.removeChild(node)
    }
    return { stop, [Symbol.dispose]: stop }
}
