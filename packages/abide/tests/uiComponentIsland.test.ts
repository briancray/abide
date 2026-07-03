import { afterEach, beforeAll, expect, test } from 'bun:test'
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

/* A controllable IntersectionObserver so an island takes the visible path and the test decides
   when it scrolls into view. */
function installFakeObserver(): { fire: () => void } {
    let callback: (entries: { isIntersecting: boolean }[]) => void = () => undefined
    class FakeObserver {
        constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
            callback = cb
        }
        observe(): void {}
        disconnect(): void {}
    }
    globalWithObserver.IntersectionObserver = FakeObserver
    return { fire: () => callback([{ isIntersecting: true }]) }
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

test('client:visible island — server markup kept, build skipped at boot, run on visible', () => {
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

    /* Scrolled into view → the island builds fresh, replacing the kept server markup. */
    observer.fire()
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
