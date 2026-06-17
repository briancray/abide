import { afterEach, describe, expect, test } from 'bun:test'
import { mountChild } from '../src/lib/ui/dom/mountChild.ts'
import { hotInstances } from '../src/lib/ui/runtime/hotInstances.ts'
import { hotReloadEnabled } from '../src/lib/ui/runtime/hotReloadEnabled.ts'
import { hotReplace } from '../src/lib/ui/runtime/hotReplace.ts'
import { OWNER } from '../src/lib/ui/runtime/OWNER.ts'
import { scope } from '../src/lib/ui/runtime/scope.ts'
import type { UiComponent } from '../src/lib/ui/runtime/types/UiComponent.ts'

/* A stub component factory: records each (host, props) mount and the disposer
   it hands back, so a test can assert what was mounted and torn down. The
   registry never touches the host, so a plain object stands in for the element. */
function stubFactory(moduleId?: string) {
    const mounts: Array<{ host: unknown; props: unknown; disposed: boolean }> = []
    const factory = ((host: unknown, props: unknown) => {
        const record = { host, props, disposed: false }
        mounts.push(record)
        return () => {
            record.disposed = true
        }
    }) as unknown as UiComponent
    factory.__abideId = moduleId
    return { factory, mounts }
}

const HOST = {} as unknown as Element

afterEach(() => {
    hotReloadEnabled.current = false
    hotInstances.clear()
})

describe('mountChild', () => {
    test('plain path runs the factory and records nothing', () => {
        const { factory, mounts } = stubFactory('a.abide')
        mountChild(HOST, factory, { x: () => 1 } as never)
        expect(mounts).toHaveLength(1)
        expect(hotInstances.size).toBe(0)
    })

    test('hot path records the instance under its module id', () => {
        hotReloadEnabled.current = true
        const { factory } = stubFactory('a.abide')
        scope(() => mountChild(HOST, factory, undefined))
        expect(hotInstances.get('a.abide')?.size).toBe(1)
    })

    test('a factory with no module id falls back to the plain path', () => {
        hotReloadEnabled.current = true
        const { factory, mounts } = stubFactory(undefined)
        scope(() => mountChild(HOST, factory, undefined))
        expect(mounts).toHaveLength(1)
        expect(hotInstances.size).toBe(0)
    })

    test('owner teardown disposes the instance and drops it from the registry', () => {
        hotReloadEnabled.current = true
        const { factory, mounts } = stubFactory('a.abide')
        const dispose = scope(() => mountChild(HOST, factory, undefined))
        dispose()
        expect(mounts[0]?.disposed).toBe(true)
        expect(hotInstances.has('a.abide')).toBe(false)
        expect(OWNER.current).toBeUndefined()
    })
})

describe('hotReplace', () => {
    test('disposes each live instance and re-runs the next factory with the same host + props', () => {
        hotReloadEnabled.current = true
        const props = { label: () => 'hi' } as never
        const previous = stubFactory('card.abide')
        scope(() => mountChild(HOST, previous.factory, props))

        const next = stubFactory('card.abide')
        expect(hotReplace('card.abide', next.factory)).toBe(true)

        expect(previous.mounts[0]?.disposed).toBe(true)
        expect(next.mounts).toHaveLength(1)
        expect(next.mounts[0]?.host).toBe(HOST)
        expect(next.mounts[0]?.props).toBe(props)
    })

    test('a swap leaves the instance disposable by the original owner', () => {
        hotReloadEnabled.current = true
        const previous = stubFactory('card.abide')
        const dispose = scope(() => mountChild(HOST, previous.factory, undefined))

        const next = stubFactory('card.abide')
        hotReplace('card.abide', next.factory)
        dispose()

        expect(next.mounts[0]?.disposed).toBe(true)
        expect(hotInstances.has('card.abide')).toBe(false)
    })

    test('an unknown module id swaps nothing and returns false', () => {
        expect(hotReplace('missing.abide', stubFactory().factory)).toBe(false)
    })
})
