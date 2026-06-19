import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { mount } from '../src/lib/ui/dom/mount.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { CURRENT_SCOPE } from '../src/lib/ui/runtime/CURRENT_SCOPE.ts'
import { scope } from '../src/lib/ui/scope.ts'
import type { Scope } from '../src/lib/ui/types/Scope.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})
/* A prior test in the full suite may leave a lazily-minted ambient scope set
   (any `scope()` call outside a mount caches one); reset before each so the
   "restored to undefined" assertion measures this test's mount, not the leak. */
beforeEach(() => {
    CURRENT_SCOPE.current = undefined
})
afterEach(() => {
    CURRENT_SCOPE.current = undefined
})

describe('scope integration — scope() live in a mounted component', () => {
    test('scope() during build is the component scope; its doc holds the state', () => {
        let here: Scope | undefined
        const host = document.createElement('div')

        const dispose = mount(host, () => {
            here = scope()
            here.replace('count', 0)
        })

        expect(here?.read<number>('count')).toBe(0)
        here?.replace('count', 9)
        expect(here?.read<number>('count')).toBe(9)
        expect(here?.snapshot()).toEqual({ count: 9 })
        // the ambient is restored after the (synchronous) build
        expect(CURRENT_SCOPE.current).toBeUndefined()
        dispose()
    })

    test('scope().record() then undo, via the scope handle', () => {
        let here: Scope | undefined
        const host = document.createElement('div')

        const dispose = mount(host, () => {
            here = scope()
            here.record()
        })

        here?.replace('n', 1)
        here?.replace('n', 2)
        expect(here?.canUndo()).toBe(true)
        here?.undo()
        expect(here?.read<number>('n')).toBe(1)
        dispose()
    })

    test('on-capture: a handler calling ambient scope().undo() acts on the component', () => {
        const host = document.createElement('div')
        let here: Scope | undefined
        let button: { dispatchEvent: (event: { type: string }) => void } | undefined

        const dispose = mount(host, () => {
            here = scope()
            here.replace('n', 0)
            here.record() // journal changes after the initial value
            const element = document.createElement('button')
            on(element as unknown as Element, 'click', () => scope().undo())
            button = element as unknown as typeof button
        })

        here?.replace('n', 5)
        expect(here?.read<number>('n')).toBe(5)
        // fires AFTER the build, when CURRENT_SCOPE has been restored to undefined
        button?.dispatchEvent({ type: 'click' })
        expect(here?.read<number>('n')).toBe(0) // undo ran on the component scope
        dispose()
    })

    test('effect-capture: a deferred effect re-run resolves the component scope', () => {
        const host = document.createElement('div')
        let here: Scope | undefined
        let componentScope: Scope | undefined
        const seen: (Scope | undefined)[] = []

        const dispose = mount(host, () => {
            here = scope()
            componentScope = scope()
            here.replace('n', 0)
            effect(() => {
                here?.read<number>('n') // track
                seen.push(scope())
            })
        })

        seen.length = 0 // drop the build-time first run
        here?.replace('n', 1) // a re-run, fired after the build
        expect(seen[0]).toBe(componentScope) // resolved the component, not undefined
        dispose()
    })
})
