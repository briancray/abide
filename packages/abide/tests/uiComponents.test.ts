import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { derived } from '../src/lib/ui/derived.ts'
import { doc } from '../src/lib/ui/doc.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { awaitBlock } from '../src/lib/ui/dom/awaitBlock.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { mount } from '../src/lib/ui/dom/mount.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { openChild } from '../src/lib/ui/dom/openChild.ts'
import { text } from '../src/lib/ui/dom/text.ts'
import { when } from '../src/lib/ui/dom/when.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

const RUNTIME = {
    doc,
    state,
    derived,
    effect,
    openChild,
    appendText,
    appendStatic,
    text,
    attr,
    on,
    each,
    when,
    awaitBlock,
    mount,
}

/* Builds a mountable component `(host, $props) => void` from source. */
function component(
    source: string,
    extra: Record<string, unknown> = {},
): (host: Element, props?: unknown) => void {
    const body = compileComponent(source)
    const runtime = { ...RUNTIME, ...extra }
    const names = Object.keys(runtime)
    return (host: Element, props?: unknown) => {
        new Function('host', '$props', ...names, body)(
            host,
            props,
            ...names.map((n) => runtime[n as keyof typeof runtime]),
        )
    }
}

describe('component composition', () => {
    test('a child receives a reactive prop that updates from the parent', () => {
        const Greeting = component(`
            <script>let label = prop('label')</script>
            <span>Hi {label}</span>
        `)

        const host = document.createElement('div')
        component(
            `
            <script>
                let name = state('world')
                function change() { name = 'abide' }
            </script>
            <div>
                <Greeting label={name} />
                <button onclick={change}>go</button>
            </div>
        `,
            { Greeting },
        )(host)

        // child rendered with the initial prop value
        expect(host.textContent).toContain('Hi world')

        // a parent event changes the prop source → the child re-renders reactively
        const findButton = (node: {
            childNodes: { tagName?: string; childNodes?: unknown[] }[]
        }): {
            dispatchEvent: (event: { type: string }) => void
        } => {
            for (const child of node.childNodes) {
                if (child.tagName === 'button') {
                    return child as unknown as { dispatchEvent: (event: { type: string }) => void }
                }
                if (child.childNodes !== undefined) {
                    const found = findButton(
                        child as { childNodes: { tagName?: string }[] } as never,
                    )
                    if (found !== undefined) {
                        return found
                    }
                }
            }
            return undefined as never
        }
        findButton(host as never).dispatchEvent({ type: 'click' })
        expect(host.textContent).toContain('Hi abide')
    })

    test('a static prop is passed through', () => {
        const Badge = component(`
            <script>let kind = prop('kind')</script>
            <em>{kind}</em>
        `)
        const host = document.createElement('div')
        component(`<div><Badge kind="new" /></div>`, { Badge })(host)
        expect(host.textContent).toContain('new')
    })
})
