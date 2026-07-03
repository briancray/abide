import { afterEach, beforeAll, expect, test } from 'bun:test'
import { whenVisible } from '../src/lib/ui/runtime/whenVisible.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

const globalWithObserver = globalThis as {
    IntersectionObserver?: unknown
}
afterEach(() => {
    delete globalWithObserver.IntersectionObserver
})

/* A controllable IntersectionObserver: capture the callback so a test can fire intersection on
   demand, and record disconnect so the once-then-disconnect contract can be asserted. */
function installFakeObserver(): {
    fire: (isIntersecting: boolean) => void
    observed: Element[]
    disconnected: () => boolean
} {
    let callback: (entries: { isIntersecting: boolean }[]) => void = () => undefined
    const observed: Element[] = []
    let disconnectedFlag = false
    class FakeObserver {
        constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
            callback = cb
        }
        observe(element: Element): void {
            observed.push(element)
        }
        disconnect(): void {
            disconnectedFlag = true
        }
    }
    globalWithObserver.IntersectionObserver = FakeObserver
    return {
        fire: (isIntersecting) => callback([{ isIntersecting }]),
        observed,
        disconnected: () => disconnectedFlag,
    }
}

test('fires once when the element intersects, then disconnects', () => {
    const observer = installFakeObserver()
    const element = document.createElement('div')
    let fired = 0
    whenVisible(element, () => {
        fired += 1
    })

    expect(observer.observed).toEqual([element]) // observing the element, not yet fired
    expect(fired).toBe(0)

    observer.fire(false) // a non-intersecting entry does nothing
    expect(fired).toBe(0)

    observer.fire(true) // intersecting → fire + disconnect
    expect(fired).toBe(1)
    expect(observer.disconnected()).toBe(true)
})

test('cancel disconnects a pending watch without firing', () => {
    const observer = installFakeObserver()
    let fired = 0
    const cancel = whenVisible(document.createElement('div'), () => {
        fired += 1
    })
    cancel()
    expect(observer.disconnected()).toBe(true)
    expect(fired).toBe(0)
})

test('no observer available: fires synchronously so the region never stays inert', () => {
    let fired = 0
    whenVisible(document.createElement('div'), () => {
        fired += 1
    })
    expect(fired).toBe(1)
})
