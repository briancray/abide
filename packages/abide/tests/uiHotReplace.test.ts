import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { mountChild } from '../src/lib/ui/dom/mountChild.ts'
import { hotInstances } from '../src/lib/ui/runtime/hotInstances.ts'
import { hotReloadEnabled } from '../src/lib/ui/runtime/hotReloadEnabled.ts'
import { hotReplace } from '../src/lib/ui/runtime/hotReplace.ts'
import { OWNER } from '../src/lib/ui/runtime/OWNER.ts'
import { scope } from '../src/lib/ui/runtime/scope.ts'
import type { UiComponent } from '../src/lib/ui/runtime/types/UiComponent.ts'
import { installMiniDom } from './support/installMiniDom.ts'

/* A stub component factory: its `build` (the entry `mountChild`/`mountRange` call)
   records each (host, props) mount and registers a teardown with the owner, so a test
   can assert what was mounted and torn down. A child mounts as a marker range, so
   `build` receives the build fragment as its host, not a wrapper element. */
function stubFactory(moduleId?: string) {
    const mounts: Array<{ host: unknown; props: unknown; disposed: boolean }> = []
    const build = (host: unknown, props: unknown) => {
        const record = { host, props, disposed: false }
        mounts.push(record)
        OWNER.current?.push(() => {
            record.disposed = true
        })
    }
    const factory = (() => undefined) as unknown as UiComponent
    factory.build = build as UiComponent['build']
    factory.__abideId = moduleId
    return { factory, mounts }
}

beforeAll(() => {
    installMiniDom()
})

afterEach(() => {
    hotReloadEnabled.current = false
    hotInstances.clear()
})

describe('mountChild', () => {
    test('plain path runs the factory and records nothing', () => {
        const parent = document.createElement('div')
        const { factory, mounts } = stubFactory('a.abide')
        mountChild(parent, factory, { x: () => 1 } as never)
        expect(mounts).toHaveLength(1)
        expect(hotInstances.size).toBe(0)
    })

    test('hot path records the instance under its module id', () => {
        hotReloadEnabled.current = true
        const parent = document.createElement('div')
        const { factory } = stubFactory('a.abide')
        scope(() => mountChild(parent, factory, undefined))
        expect(hotInstances.get('a.abide')?.size).toBe(1)
    })

    test('a factory with no module id falls back to the plain path', () => {
        hotReloadEnabled.current = true
        const parent = document.createElement('div')
        const { factory, mounts } = stubFactory(undefined)
        scope(() => mountChild(parent, factory, undefined))
        expect(mounts).toHaveLength(1)
        expect(hotInstances.size).toBe(0)
    })

    test('owner teardown disposes the instance and drops it from the registry', () => {
        hotReloadEnabled.current = true
        const parent = document.createElement('div')
        const { factory, mounts } = stubFactory('a.abide')
        const dispose = scope(() => mountChild(parent, factory, undefined))
        dispose()
        expect(mounts[0]?.disposed).toBe(true)
        expect(hotInstances.has('a.abide')).toBe(false)
        expect(OWNER.current).toBeUndefined()
    })
})

describe('hotReplace', () => {
    test('disposes each live instance and re-fills its range with the next build + same props', () => {
        hotReloadEnabled.current = true
        const parent = document.createElement('div')
        const props = { label: () => 'hi' } as never
        const previous = stubFactory('card.abide')
        scope(() => mountChild(parent, previous.factory, props))

        const next = stubFactory('card.abide')
        expect(hotReplace('card.abide', next.factory)).toBe(true)

        expect(previous.mounts[0]?.disposed).toBe(true)
        expect(next.mounts).toHaveLength(1)
        expect(next.mounts[0]?.props).toBe(props)
    })

    test('a swap leaves the instance disposable by the original owner', () => {
        hotReloadEnabled.current = true
        const parent = document.createElement('div')
        const previous = stubFactory('card.abide')
        const dispose = scope(() => mountChild(parent, previous.factory, undefined))

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
