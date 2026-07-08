import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { bindableProp } from '../src/lib/ui/dom/bindableProp.ts'
import { bindProp } from '../src/lib/ui/dom/bindProp.ts'
import { mount } from '../src/lib/ui/dom/mount.ts'
import { effect } from '../src/lib/ui/effect.ts'
import type { UiProps } from '../src/lib/ui/runtime/types/UiProps.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

/* The runtime contract behind a two-way `bind:prop`: `bindProp` is the parent-side
   value thunk + `set` channel; `bindableProp` is the child-side cell that reads it. */
describe('bindProp / bindableProp — the two-way prop channel', () => {
    test('a bound prop is a pass-through: reads track the parent, writes flow upstream', () => {
        const count = state('a')
        const props = {
            value: bindProp(
                () => count.value,
                (next) => {
                    count.value = next as string
                },
            ),
        } as unknown as UiProps
        const cell = bindableProp<string>(props, 'value')
        /* Reads reflect the parent's current value. */
        expect(cell.value).toBe('a')
        /* A parent change is visible through the cell (no local copy shadows it). */
        count.value = 'b'
        expect(cell.value).toBe('b')
        /* A child write flows straight upstream to the parent's target. */
        cell.value = 'c'
        expect(count.value).toBe('c')
        expect(cell.value).toBe('c')
    })

    test('reading a bound prop inside an effect re-runs when the parent changes', () => {
        const count = state(1)
        const props = {
            value: bindProp(
                () => count.value,
                (next) => {
                    count.value = next as number
                },
            ),
        } as unknown as UiProps
        const cell = bindableProp<number>(props, 'value')
        let seen = 0
        const dispose = effect(() => {
            seen = cell.value
        })
        expect(seen).toBe(1)
        count.value = 42
        expect(seen).toBe(42)
        dispose()
    })

    test('an unbound prop degrades to a local cell: writes stay local, parent reseeds it', () => {
        const source = state('x')
        /* A plain value thunk (no `set`) — the shape a non-`bind:` prop compiles to. */
        const props = { value: () => source.value } as unknown as UiProps
        const cell = bindableProp<string>(props, 'value')
        expect(cell.value).toBe('x')
        /* A local write is held, and does NOT flow upstream. */
        cell.value = 'local'
        expect(cell.value).toBe('local')
        expect(source.value).toBe('x')
        /* A parent change reseeds the local cell (linked semantics). */
        source.value = 'y'
        expect(cell.value).toBe('y')
    })

    test('an absent prop falls back to its default and stays locally writable', () => {
        const props = {} as UiProps
        const cell = bindableProp<number>(props, 'value', () => 0)
        expect(cell.value).toBe(0)
        cell.value = 5
        expect(cell.value).toBe(5)
    })
})

/* Mounts a compiled child body against a fresh host with a hand-built prop bag —
   exactly the shape a parent's `composeProps` produces — so the whole client wiring
   (child `bindableProp` cell ↔ element `bind:value`) is exercised end to end. */
function mountChild(source: string, props: UiProps): HTMLElement {
    const body = compileComponent(source)
    const host = document.createElement('div')
    mount(host, (target) => {
        new Function('host', '$props', body)(target, props)
    })
    return host
}

describe('bind:prop on a component — end to end', () => {
    test('a child forwarding a bound prop to <input bind:value> is fully two-way', () => {
        const count = state('hello')
        const props = {
            value: bindProp(
                () => count.value,
                (next) => {
                    count.value = next as string
                },
            ),
        } as unknown as UiProps
        const host = mountChild(
            `
            <script>
                import { props } from '@abide/abide/ui/props'
                const { value } = props()
            </script>
            <input bind:value={value} />
        `,
            props,
        )
        const input = Array.from(host.childNodes).find(
            (node) => (node as { tagName?: string }).tagName === 'input',
        ) as unknown as { value: string; dispatchEvent: (event: { type: string }) => void }
        /* Parent → child: the input starts at the parent's value. */
        expect(input.value).toBe('hello')
        /* Parent → child: a parent change drives the input. */
        count.value = 'world'
        expect(input.value).toBe('world')
        /* Child → parent: editing the input writes back to the parent's state. */
        input.value = 'typed'
        input.dispatchEvent({ type: 'input' })
        expect(count.value).toBe('typed')
    })
})
