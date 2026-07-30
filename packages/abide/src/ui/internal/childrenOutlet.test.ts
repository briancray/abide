// The default-children outlet — `<slot/>` — across both emitters, plus the retirement of the
// `{children()}` interpolation form.
//
// `<slot/>` does not lower to a text leaf: it lowers to a zero-prop COMPONENT invocation whose
// componentFn IS `$scope.children` (`templatePlan.pushChildrenSlot`), so whatever a childless caller
// passes down as its children factory is what the outlet is asked to invoke. The two lanes had picked
// different values for that one field:
//
//   childless <Card/>   server: $rt.emptyChildren (a function) → outlet renders nothing
//                       client: null                           → outlet THROWS on hydrate
//
// `componentAttrLanes.test.ts` cannot catch this family by construction: it compares RENDERED OUTPUT,
// and here only the client lane throws — the server's HTML is correct and the divergence is an
// exception, not a diff. So this file renders AND hydrates the same markup and treats a throw as an
// observable, which is what makes the asymmetry visible.
//
// The second half is the API question the first half exposed: `{children()}` was a special case carved
// out of the one law the compiler states about interpolations ("an interpolation renders text; a
// component is a tag"), and `emitCheck` declared a `children` intrinsic so the carve-out type-checked.
// `<slot/>` is now the only spelling, and `children` is the internal scope name the outlet resolves
// off — not a binding a template may reach.

import { describe, expect, test } from 'bun:test'
import { type ComponentResolver, loadEmitted } from './emit.ts'
import { emitCheck } from './emitCheck.ts'
import { parse } from './parse.ts'
import { validateTemplate } from './validateTemplate.ts'

const OUTLET = '<i><slot/></i>'
// A component that renders its children TWICE around a childless inline component of its own. The inner
// `<Bare/>` must render nothing: its scope is `Object.create` of a scope that DOES carry `children`, so
// an outlet that falls through the prototype chain renders the outer children a third time.
const NESTED = '{#component Bare()}<u><slot/></u>{/component}' + '<i><slot/><Bare/><slot/></i>'

const resolve: ComponentResolver = (specifier) =>
    specifier === './Outlet.abide' ? OUTLET : specifier === './Nested.abide' ? NESTED : undefined

const strip = (html: string): string => html.replace(/<!--\[-->|<!--\]-->|<!---->/g, '')

// Render on the server, then hydrate the SAME markup. A hydrate throw is returned as a value rather
// than propagated, so a lane that throws where the other renders shows up as a DIFF here instead of
// killing the test with a stack that says nothing about the asymmetry.
async function bothLanes(page: string): Promise<{ server: string; client: string }> {
    const emitted = await loadEmitted(page, resolve)
    const host = document.createElement('div')
    host.innerHTML = await emitted.render({})
    const server = strip(host.innerHTML)
    let client: string
    try {
        emitted.hydrate(host, {})
        await Promise.resolve()
        await Promise.resolve()
        client = strip(host.innerHTML)
    } catch (error) {
        client = `THREW: ${(error as Error).message}`
    }
    return { server, client }
}

describe('<slot/> with no children — the lanes must agree', () => {
    test.each([
        [
            'file component',
            '<script>import Outlet from "./Outlet.abide"</script><Outlet/>',
            '<i></i>',
        ],
        ['inline component', '{#component Card()}<i><slot/></i>{/component}<Card/>', '<i></i>'],
        [
            'inline component nested in a childless file component',
            '<script>import Nested from "./Nested.abide"</script><Nested/>',
            '<i><u></u></i>',
        ],
    ])('%s renders nothing on both sides', async (_shape, page, expected) => {
        const { server, client } = await bothLanes(page)
        expect(server).toBe(expected)
        // The assertion the bug lived under. The client used to be
        // `THREW: <children> is not a component in scope (expected a mount function)`.
        expect(client).toBe(server)
    })
})

describe('<slot/> with children — the contrast case, and the scope it must not leak', () => {
    test('a file component renders its children on both sides', async () => {
        const { server, client } = await bothLanes(
            '<script>import Outlet from "./Outlet.abide"</script><Outlet>hi</Outlet>',
        )
        expect(server).toBe('<i>hi</i>')
        expect(client).toBe(server)
    })

    // The leak the `null` opened: an inline component's adapter installs children as
    // `if (typeof $args[1] === "function")`, so a `null` left `$s.children` UNSET — and the outlet
    // inside the childless `<Bare/>` resolved the ENCLOSING component's children off the prototype
    // chain. Expected `<u></u>`, not `<u>hi</u>`.
    test('a childless inline component does not inherit the enclosing children', async () => {
        const { server, client } = await bothLanes(
            '<script>import Nested from "./Nested.abide"</script><Nested>hi</Nested>',
        )
        expect(server).toBe('<i>hi<u></u>hi</i>')
        expect(client).toBe(server)
    })
})

describe('{children()} is retired — <slot/> is the only spelling', () => {
    // One gate, asked twice: `validateTemplate` runs `buildPlan` and reports what it throws, so the
    // check lane and the LSP reject exactly what `abide build` rejects — by construction rather than by
    // two switches that have to be kept in step.
    // Every EXPRESSION POSITION, not just the interpolation the old carve-out lived in. The reservation
    // sits in `rewriteExpr`, the one funnel all of these pass through.
    test.each([
        ['bare interpolation', '<i>{children()}</i>'],
        ['an element attribute value', '<i title={children()}>x</i>'],
        ['a block head', '<i>{#if children}a{/if}</i>'],
        ['an uncalled reference', '<i>{children}</i>'],
        ['inside an inline component', '{#component Card()}<i>{children()}</i>{/component}<Card/>'],
        // Not exempt, and deliberately so: a `{#for}` item is published on the same `$scope` chain the
        // outlet reads, so inside the body `<slot/>` would render the ITEM. The name is reserved.
        ['a {#for} item of the same name', '<i>{#for children of list}{children}{/for}</i>'],
    ])('%s is a compile error naming <slot/>', (_where, source) => {
        const verdict = validateTemplate(parse(source))
        expect(verdict.legal).toBe(false)
        expect(verdict.legal === false && verdict.rejected).toContain('<slot/>')
    })

    // The rejection is about a FREE identifier, not about the word — so it must not fire on a member
    // access, a string, an object key, or a name the author declared LEXICALLY (those stay lexical in the
    // emit and never touch `$scope`, so there is nothing to collide with).
    test.each([
        ['a member call', '<i>{node.children()}</i>'],
        ['a property read', '<i>{node.children.length}</i>'],
        ['a string literal', '<i>{"has children"}</i>'],
        ['an object key', '<i>{JSON.stringify({ children: 1 })}</i>'],
        [
            'a script binding of the same name',
            '<script>const children = 2</script><i>{children}</i>',
        ],
    ])('%s is still legal', (_shape, source) => {
        const verdict = validateTemplate(parse(source))
        expect(verdict.legal === false ? verdict.rejected : 'legal').toBe('legal')
    })

    // The other half of the retirement. `emitCheck` declared `children` ambiently as
    // `declare function children(): unknown`, which is what made `{children()}` type-check — and typed
    // it as ALWAYS a function, so `{#if children}` was always true and the fallback idiom the compiler
    // spec used to advertise could never take its `{:else}` branch. With the intrinsic gone, `children`
    // is an undeclared name in a template expression, which is the diagnostic it should always have been.
    test('the check lane declares no children intrinsic', () => {
        const source = '<p>{x}</p>'
        const { code } = emitCheck(source, parse(source))
        expect(code).not.toContain('declare function children')
    })
})
