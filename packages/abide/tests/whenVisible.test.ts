import { afterEach, beforeAll, expect, test } from 'bun:test'
import { whenVisible } from '../src/lib/ui/runtime/whenVisible.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

const globalWithObserver = globalThis as { IntersectionObserver?: unknown }
afterEach(() => {
    delete globalWithObserver.IntersectionObserver
})

/* Lets the batched wake flush (rAF → setTimeout fallback in this env) run. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/* A controllable shared IntersectionObserver: records observed/unobserved elements and fires
   intersection for a chosen target on demand — mirroring the one-observer-many-targets shape
   whenVisible now uses. */
function installFakeObserver(): {
    fire: (element: Element) => void
    observed: Element[]
    unobserved: Element[]
} {
    let callback: (entries: { isIntersecting: boolean; target: Element }[]) => void = () =>
        undefined
    const observed: Element[] = []
    const unobserved: Element[] = []
    class FakeObserver {
        constructor(cb: (entries: { isIntersecting: boolean; target: Element }[]) => void) {
            callback = cb
        }
        observe(element: Element): void {
            observed.push(element)
        }
        unobserve(element: Element): void {
            unobserved.push(element)
        }
        disconnect(): void {}
    }
    globalWithObserver.IntersectionObserver = FakeObserver
    return {
        fire: (element) => callback([{ isIntersecting: true, target: element }]),
        observed,
        unobserved,
    }
}

test('fires once when the element intersects, then unobserves', async () => {
    const observer = installFakeObserver()
    const element = document.createElement('div')
    let fired = 0
    whenVisible(element, () => {
        fired += 1
    })

    expect(observer.observed).toContain(element) // observing, not yet fired
    expect(fired).toBe(0)

    observer.fire(element) // intersecting → queue + unobserve; wake runs on the next frame
    expect(fired).toBe(0)
    await flush()
    expect(fired).toBe(1)
    expect(observer.unobserved).toContain(element)
})

test('cancel unobserves a pending watch without firing', async () => {
    const observer = installFakeObserver()
    let fired = 0
    const element = document.createElement('div')
    const cancel = whenVisible(element, () => {
        fired += 1
    })
    cancel()
    expect(observer.unobserved).toContain(element)

    /* A late intersection after cancel does nothing — the element was dropped from the map. */
    observer.fire(element)
    await flush()
    expect(fired).toBe(0)
})

test('no observer available: fires synchronously so the region never stays inert', () => {
    let fired = 0
    whenVisible(document.createElement('div'), () => {
        fired += 1
    })
    expect(fired).toBe(1)
})

test('one shared observer backs many watchers; each wakes only its own target', async () => {
    const observer = installFakeObserver()
    const a = document.createElement('div')
    const b = document.createElement('div')
    let firedA = 0
    let firedB = 0
    whenVisible(a, () => {
        firedA += 1
    })
    whenVisible(b, () => {
        firedB += 1
    })

    observer.fire(a) // only a's target intersects
    await flush()
    expect(firedA).toBe(1)
    expect(firedB).toBe(0)

    observer.fire(b)
    await flush()
    expect(firedB).toBe(1)
})
