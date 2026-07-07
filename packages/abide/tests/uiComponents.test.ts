import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { awaitBlock } from '../src/lib/ui/dom/awaitBlock.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { mount } from '../src/lib/ui/dom/mount.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { text } from '../src/lib/ui/dom/text.ts'
import { when } from '../src/lib/ui/dom/when.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

const RUNTIME = {
    doc,
    state,
    computed,
    effect,
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
    const fn = (host: Element, props?: unknown) => {
        new Function('host', '$props', ...names, body)(
            host,
            props,
            ...names.map((n) => runtime[n as keyof typeof runtime]),
        )
    }
    /* The fn IS the bare build (runs the body on host); a nested child mounts via
       `mountChild`, which calls `factory.build` — see compileModule. */
    return Object.assign(fn, { build: fn })
}

/* The first element with `tag` anywhere under `node` — the mini-dom has no
   querySelector, so walk childNodes recursively (tagName is upper-case). */
function findTag(
    node: { childNodes: { tagName?: string; childNodes?: unknown[] }[] },
    tag: string,
): { tagName?: string; childNodes?: unknown[] } | undefined {
    for (const child of node.childNodes) {
        if (child.tagName?.toLowerCase() === tag) {
            return child
        }
        if (child.childNodes !== undefined) {
            const found = findTag(child as { childNodes: { tagName?: string }[] } as never, tag)
            if (found !== undefined) {
                return found
            }
        }
    }
    return undefined
}

/* The first `<button>` anywhere under `node`. */
function findButton(node: { childNodes: { tagName?: string; childNodes?: unknown[] }[] }): {
    dispatchEvent: (event: { type: string }) => void
} {
    return findTag(node, 'button') as unknown as {
        dispatchEvent: (event: { type: string }) => void
    }
}

describe('component composition', () => {
    test('a child receives a reactive prop that updates from the parent', () => {
        const Greeting = component(`
            <script>import { props } from '@abide/abide/ui/props'
            const { label } = props()</script>
            <span>Hi {label}</span>
        `)

        const host = document.createElement('div')
        component(
            `
            <script>import { state } from '@abide/abide/ui/state'

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
            <script>import { props } from '@abide/abide/ui/props'
            const { kind } = props()</script>
            <em>{kind}</em>
        `)
        const host = document.createElement('div')
        component(`<div><Badge kind="new" /></div>`, { Badge })(host)
        expect(host.textContent).toContain('new')
    })

    test('a component tag bound by a {#for} item mounts the looped component', () => {
        /* The tag `<Icon>` is the loop item `icon: Icon`, a reactive cell. The
           component-tag emitter must deref it (`Icon.value`) like every other reference
           site — emitting the raw cell hands `mountChild` a `{ value }` object whose
           `.build` is undefined, throwing `build is not a function`. */
        const Star = component(`<em>star</em>`)
        const Bolt = component(`<em>bolt</em>`)
        const host = document.createElement('div')
        component(
            `<script>const ICONS = [{ key: 'a', icon: Star }, { key: 'b', icon: Bolt }]</script>
{#for { key, icon: Icon } of ICONS by key}<Icon />{/for}`,
            { Star, Bolt },
        )(host)
        expect(host.textContent).toContain('star')
        expect(host.textContent).toContain('bolt')
    })

    test('a `props()` destructure default fills in for an absent prop', () => {
        const Badge = component(`
            <script>import { props } from '@abide/abide/ui/props'
            const { lang = 'ts' } = props()</script>
            <em>{lang}</em>
        `)
        const absent = document.createElement('div')
        component(`<div><Badge /></div>`, { Badge })(absent)
        expect(absent.textContent).toContain('ts')

        const passed = document.createElement('div')
        component(`<div><Badge lang="js" /></div>`, { Badge })(passed)
        expect(passed.textContent).toContain('js')
    })

    test('a `props()` binding stays reactive and honours a rename', () => {
        const Greeting = component(`
            <script>import { props } from '@abide/abide/ui/props'
            const { who: name = 'world' } = props()</script>
            <span>Hi {name}</span>
        `)
        const host = document.createElement('div')
        component(
            `
            <script>import { state } from '@abide/abide/ui/state'

                let name = state('world')
                function change() { name = 'abide' }
            </script>
            <div>
                <Greeting who={name} />
                <button onclick={change}>go</button>
            </div>
        `,
            { Greeting },
        )(host)
        expect(host.textContent).toContain('Hi world')
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
})

describe('spread props', () => {
    /* The child reads each key as a normal prop, so any subset is supplied at once. */
    test('a `{...object}` spreads its keys onto the child', () => {
        const Card = component(`
            <script>import { props } from '@abide/abide/ui/props'
            const { title, body } = props()</script>
            <article>{title}: {body}</article>
        `)
        const host = document.createElement('div')
        component(
            `<script>const data = { title: 'Hi', body: 'there' }</script>
             <div><Card {...data} /></div>`,
            { Card },
        )(host)
        expect(host.textContent).toContain('Hi: there')
    })

    /* Source order decides overrides (like JSX): an explicit prop after a spread wins,
       and a spread after an explicit prop wins. */
    test('source order resolves spread-vs-explicit overrides', () => {
        const Show = component(`
            <script>import { props } from '@abide/abide/ui/props'
            const { value } = props()</script>
            <em>{value}</em>
        `)
        const explicitWins = document.createElement('div')
        component(
            `<script>const data = { value: 'spread' }</script>
             <div><Show {...data} value="explicit" /></div>`,
            { Show },
        )(explicitWins)
        expect(explicitWins.textContent).toContain('explicit')

        const spreadWins = document.createElement('div')
        component(
            `<script>const data = { value: 'spread' }</script>
             <div><Show value="explicit" {...data} /></div>`,
            { Show },
        )(spreadWins)
        expect(spreadWins.textContent).toContain('spread')
    })

    /* A spread key stays live: mutating the source object's value re-renders the child. */
    test('a spread key stays reactive', () => {
        const Greeting = component(`
            <script>import { props } from '@abide/abide/ui/props'
            const { name } = props()</script>
            <span>Hi {name}</span>
        `)
        const host = document.createElement('div')
        component(
            `<script>import { state } from '@abide/abide/ui/state'

                const props = state({ name: 'world' })
                function change() { props = { name: 'abide' } }
             </script>
             <div>
                <Greeting {...props} />
                <button onclick={change}>go</button>
             </div>`,
            { Greeting },
        )(host)
        expect(host.textContent).toContain('Hi world')
        findButton(host as never).dispatchEvent({ type: 'click' })
        expect(host.textContent).toContain('Hi abide')
    })

    /* `const { foo, ...rest } = props()` collects the props not explicitly named, then
       `{...rest}` forwards them onto a native element as attributes. */
    test('rest props forward onto a native element', () => {
        const Field = component(`
            <script>import { props } from '@abide/abide/ui/props'
            const { label, ...rest } = props()</script>
            <input {...rest} />
        `)
        const host = document.createElement('div')
        component(`<div><Field label="Name" type="email" placeholder="you@x.com" /></div>`, {
            Field,
        })(host)
        const input = findTag(host as never, 'input') as {
            getAttribute: (name: string) => string | null
        }
        expect(input.getAttribute('type')).toBe('email')
        expect(input.getAttribute('placeholder')).toBe('you@x.com')
        // the consumed prop is NOT forwarded
        expect(input.getAttribute('label')).toBe(null)
    })

    /* An `on<event>` handler in the rest bag wires as a listener on the native element. */
    test('a rest event handler attaches as a native listener', () => {
        const Clickable = component(`
            <script>import { props } from '@abide/abide/ui/props'
            const { ...rest } = props()</script>
            <button {...rest}>go</button>
        `)
        const host = document.createElement('div')
        let clicks = 0
        component(`<div><Clickable onclick={bump} /></div>`, {
            Clickable,
            bump: () => {
                clicks += 1
            },
        })(host)
        findButton(host as never).dispatchEvent({ type: 'click' })
        expect(clicks).toBe(1)
    })

    /* A spread source that happens to carry the reserved `children` slot key must not
       surface it as slot content — the child keeps rendering its `{:else}` fallback. */
    test('a spread carrying children does not leak as slot content', () => {
        const Card = component(`
            <script>import { props } from '@abide/abide/ui/props'
            const { title, children } = props()</script>
            <article>{title} {#if children}{children()}{:else}fallback{/if}</article>
        `)
        const host = document.createElement('div')
        component(
            `<script>const data = { title: 'Hi', children: 'leak' }</script>
             <div><Card {...data} /></div>`,
            { Card },
        )(host)
        expect(host.textContent).toContain('Hi')
        expect(host.textContent).toContain('fallback')
        expect(host.textContent).not.toContain('leak')
    })

    /* `{...obj}` works directly on a native element (not only via a rest bag). */
    test('an inline object spreads onto a native element', () => {
        const host = document.createElement('div')
        component(`<script>const attrs = { id: 'x', title: 'hi' }</script>
                   <div {...attrs}></div>`)(host)
        const div = findTag(host as never, 'div') as { getAttribute: (n: string) => string | null }
        expect(div.getAttribute('id')).toBe('x')
        expect(div.getAttribute('title')).toBe('hi')
    })
})
