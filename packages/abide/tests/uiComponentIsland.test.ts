import { afterEach, beforeAll, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { hydrate } from '../src/lib/ui/dom/hydrate.ts'
import { mountChild } from '../src/lib/ui/dom/mountChild.ts'
import type { UiComponent } from '../src/lib/ui/runtime/types/UiComponent.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})
const globalWithObserver = globalThis as { IntersectionObserver?: unknown }
afterEach(() => {
    delete globalWithObserver.IntersectionObserver
})

/* Lets the batched wake flush run. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/* A controllable shared IntersectionObserver so an island takes the visible path and the test
   decides when its range scrolls into view (fires every observed target). */
function installFakeObserver(): { fire: () => void } {
    let callback: (entries: { isIntersecting: boolean; target: Element }[]) => void = () =>
        undefined
    const observed: Element[] = []
    class FakeObserver {
        constructor(cb: (entries: { isIntersecting: boolean; target: Element }[]) => void) {
            callback = cb
        }
        observe(element: Element): void {
            observed.push(element)
        }
        unobserve(element: Element): void {
            const index = observed.indexOf(element)
            if (index >= 0) {
                observed.splice(index, 1)
            }
        }
        disconnect(): void {}
    }
    globalWithObserver.IntersectionObserver = FakeObserver
    return {
        fire: () => callback(observed.map((target) => ({ isIntersecting: true, target }))),
    }
}

/* A bare component factory whose build records how many times it ran and appends a marker span,
   so a test can tell "skipped at boot" from "built on wake". No `__abideId` → the plain mount
   path (no hot-reload bookkeeping). */
function countingFactory(): { factory: UiComponent; builds: () => number } {
    let builds = 0
    const build = (host: Node): void => {
        builds += 1
        const span = document.createElement('span')
        span.appendChild(document.createTextNode('BUILT'))
        host.appendChild(span)
    }
    return {
        factory: Object.assign(build, { build }) as unknown as UiComponent,
        builds: () => builds,
    }
}

test('client:visible island — server markup kept, build skipped at boot, run on visible', async () => {
    const observer = installFakeObserver()
    const { factory, builds } = countingFactory()

    /* Server-rendered island: `[` … content … `]`, the range a component mounts into. */
    const host = document.createElement('div')
    host.innerHTML = '<!--[--><span>SERVER</span><!--]-->'

    hydrate(host, () => {
        mountChild(host, factory, undefined, null, 'Island', 'visible')
    })

    /* Boot: build skipped, server markup kept verbatim. */
    expect(builds()).toBe(0)
    expect(host.textContent).toContain('SERVER')

    /* Scrolled into view → queued, then built on the next frame, replacing the server markup. */
    observer.fire()
    await flush()
    expect(builds()).toBe(1)
    expect(host.textContent).toContain('BUILT')
    expect(host.textContent).not.toContain('SERVER')
})

test('no clientTrigger → eager hydrate (build runs at boot, as before)', () => {
    const { factory, builds } = countingFactory()
    const host = document.createElement('div')
    host.innerHTML = '<!--[--><span>BUILT</span><!--]-->'

    hydrate(host, () => {
        mountChild(host, factory, undefined, null, 'Eager')
    })

    /* The eager path builds during hydration — the island's opt-out. */
    expect(builds()).toBe(1)
})

test('compile: client:visible → mountChild trigger arg, kept out of props', () => {
    const build = compileComponent('<main><Card client:visible title="hi" /></main>')
    const mount = build.split('\n').find((line) => line.includes('mountChild')) ?? ''
    /* The trigger is the 6th arg; `client:` never becomes a prop (only `title` does). */
    expect(mount).toContain('"Card", "visible"')
    expect(build).not.toContain('client:')

    /* SSR renders the component fully — an island is server-rendered, the directive is a
       client-only hydration hint. */
    const ssr = compileSSR('<main><Card client:visible title="hi" /></main>')
    expect(ssr).not.toContain('client:')
})

test('compile: client:idle → idle trigger arg', () => {
    const build = compileComponent('<main><Chart client:idle /></main>')
    const mount = build.split('\n').find((line) => line.includes('mountChild')) ?? ''
    expect(mount).toContain('"Chart", "idle"')
})
