import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { mountChild } from '../src/lib/ui/dom/mountChild.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import { hotInstances } from '../src/lib/ui/runtime/hotInstances.ts'
import { hotReloadEnabled } from '../src/lib/ui/runtime/hotReloadEnabled.ts'
import { hotReplace } from '../src/lib/ui/runtime/hotReplace.ts'
import type { Doc } from '../src/lib/ui/runtime/types/Doc.ts'
import type { UiComponent } from '../src/lib/ui/runtime/types/UiComponent.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

afterEach(() => {
    hotInstances.clear()
    hotReloadEnabled.current = false
})

/* A stand-in for a compiled component: its `build` (what `mountChild`/`mountRange`
   calls) mints its own `model` (seeded by patches, exactly like the desugared
   `const model = doc({})` + init), then renders into a tracked text node appended to
   its build host. A nested child mounts as a marker range, so `build` receives the
   build fragment — append a node and update IT reactively (not the host's textContent,
   which the fragment loses once it lands in the range). The effect self-registers with
   the mount scope, so the swap's dispose tears it down. */
const makeComponent = (
    id: string,
    init: (model: Doc) => void,
    render: (model: Doc) => string,
): UiComponent => {
    const build = (host: Node) => {
        const model = doc({})
        init(model)
        const node = document.createTextNode('')
        host.appendChild(node)
        effect(() => {
            node.data = render(model)
        })
    }
    const factory = (() => undefined) as unknown as UiComponent
    factory.build = build as UiComponent['build']
    factory.__abideId = id
    return factory
}

const liveModel = (id: string): Doc => {
    const instance = [...(hotInstances.get(id) ?? [])][0]
    return instance?.model as Doc
}

describe('HMR — preserve component state across a hot swap', () => {
    test('a swap carries the live model state across, instead of resetting it', () => {
        hotReloadEnabled.current = true
        const host = document.createElement('div')

        const before = makeComponent(
            'counter',
            (m) => m.replace('count', 0),
            (m) => String(m.read('count')),
        )
        mountChild(host, before, undefined)
        expect(host.textContent).toBe('0')

        // user interacts: the live model moves to 5
        liveModel('counter').replace('count', 5)
        expect(host.textContent).toBe('5')

        // edit the file → a fresh factory that re-inits count to 0
        const after = makeComponent(
            'counter',
            (m) => m.replace('count', 0),
            (m) => String(m.read('count')),
        )
        expect(hotReplace('counter', after)).toBe(true)

        // the edit's render runs, but the user's 5 survived the swap
        expect(host.textContent).toBe('5')
    })

    test('an edit that changes the state shape loads cleanly (merge, not replace)', () => {
        hotReloadEnabled.current = true
        const host = document.createElement('div')

        const before = makeComponent(
            'form',
            (m) => m.replace('name', ''),
            (m) => JSON.stringify(m.snapshot()),
        )
        mountChild(host, before, undefined)
        liveModel('form').replace('name', 'Ada')

        // the edit adds a new `email` field
        const after = makeComponent(
            'form',
            (m) => {
                m.replace('name', '')
                m.replace('email', '')
            },
            (m) => JSON.stringify({ name: m.read('name'), email: m.read('email') }),
        )
        hotReplace('form', after)

        // overlapping `name` restored; newly-added `email` keeps its fresh default
        expect(host.textContent).toBe(JSON.stringify({ name: 'Ada', email: '' }))
    })

    test('a stateless component swaps with nothing to preserve (no crash)', () => {
        hotReloadEnabled.current = true
        const host = document.createElement('div')

        const before = makeComponent(
            'static',
            () => undefined, // no state → no model, no init patch
            () => 'hello',
        )
        mountChild(host, before, undefined)
        expect(liveModel('static')).toBeUndefined()

        const after = makeComponent(
            'static',
            () => undefined,
            () => 'hello v2',
        )
        expect(hotReplace('static', after)).toBe(true)
        expect(host.textContent).toBe('hello v2')
    })

    test('production path: hot reload off records no instance and adds no overhead', () => {
        hotReloadEnabled.current = false
        const host = document.createElement('div')

        const component = makeComponent(
            'prod',
            (m) => m.replace('count', 0),
            (m) => String(m.read('count')),
        )
        mountChild(host, component, undefined)

        expect(host.textContent).toBe('0')
        expect(hotInstances.get('prod')).toBeUndefined() // not tracked
        expect(hotReplace('prod', component)).toBe(false) // nothing to swap
    })
})
