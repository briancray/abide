// SERVER RUNTIME for emitted `.abide` server modules (Stage 1, PR3) — BUILD/SSR-SIDE ONLY.
//
// The string-building + attribute-serialization helpers the emitted `render($scope)` module calls.
// Deliberately lifted VERBATIM from the `renderServer.ts` interpreter (escaping rules, boolean/omit
// rules, class/style merge order, `Raw` handling) so emitted server output matches the interpreter
// byte-for-byte (modulo comment anchors). This never ships to the browser.

import { isThenable } from '../../shared/internal/isThenable.ts'
import type { EffectScope } from '../../shared/internal/reactive.ts'
import { disposeEffectScope, openEffectScope } from '../../shared/internal/reactive.ts'
import {
    onScopeDispose,
    reactiveScope,
    serverDefaultScope,
} from '../../shared/internal/reactiveScope.ts'
import {
    attributeDisposition,
    directiveIsOn,
    isSpreadHandler,
    styleDirectiveApplies,
} from './attributeDisposition.ts'
import { bindTargetKind } from './bindTarget.ts'
import { HTML_ANCHOR } from './HTML_ANCHOR.ts'

// Re-exported so the emitted server `{#for await}` can flip the `done(source)` probe when it fully
// drains a stream within the SSR pass (see emitServer.ts).
export { markIterableDone } from '../../shared/internal/iterableDone.ts'
// The emitted `render` closes its setup scope with this (the client's `mount` uses the same call).
export { closeEffectScope } from '../../shared/internal/reactive.ts'
// Streaming SSR: the emitted streaming `{#await}` block calls `$rt.awaitStream(...)` (PR2 — deadline
// race, render inline if fast, defer + placeholder if slow); the streaming `{#for await}` block calls
// `$rt.forAwaitStream(...)` (PR6 — drain to the deadline inline, then append items into an `<abide-list>`
// as they stream). See `streamScheduler.ts`.
export { awaitStream, forAwaitStream } from './streamScheduler.ts'
// Re-exported as `$rt.isThenable`: emitted SSR code guards its awaits with it (see `emitServer`).
export { isThenable }

// A server render's setup effects belong to the REQUEST. `render` opens a scope around its `<script>`
// preamble; this registers that scope's teardown on the ambient context, which `disposeScope` sweeps
// when the request's work is finished — after the response for a buffered reply, after the drain for a
// streaming one. Without it every SSR render would leave its `watch`es subscribed to whatever they read
// that outlives the request (a module-level `state`), so a single later write would re-run one dead
// effect per request ever served — the same unbounded edge `memo`'s auto-tracked fill disposes.
// A render under the process-global DEFAULT context (a bare script, a build-time render — no request)
// registers nothing: that context is never swept, so a growing disposer list would be its own leak.
// Same rule `memo` applies to a per-request slot's backing.
export function openRenderScope(): EffectScope {
    const scope = openEffectScope()
    if (reactiveScope() !== serverDefaultScope()) onScopeDispose(() => disposeEffectScope(scope))
    return scope
}

// Marks already-safe HTML that must NOT be escaped (a rendered component / the `<slot/>` children).
// The field is declared and assigned rather than written as a constructor parameter property: this
// module is reachable from `cli/check.ts`, which runs under NODE in strip-only mode (the tsgo API
// cannot open its pipe under Bun), and a parameter property is TS syntax with a runtime effect —
// stripping types cannot express it, so node rejects the whole file.
export class Raw {
    readonly value: string
    constructor(value: string) {
        this.value = value
    }
    toString(): string {
        return this.value
    }
}

// The children factory every CHILDLESS `<Name/>` site passes. Shared rather than emitted per site and
// re-allocated per invocation: it closes over nothing, and `Raw` is immutable, so one instance is
// indistinguishable from a fresh one — see `emitServer.genComponent`.
//
// It must be a FUNCTION rather than `null`, and that is a CONTRACT the client half now spells the same
// way (`runtime.emptyChildren`): `<slot/>` lowers to a component invocation whose componentFn IS
// `$scope.children`, so a childless site that passes a non-function makes the outlet fail the
// is-this-a-component check. The client used to pass `null` and threw `<children> is not a component in
// scope` on hydrate for every childless `<slot/>`, while the server rendered nothing — one field, and
// only the CLIENT lane could see it, which is why an output-comparing test could not.
const EMPTY_RAW = new Raw('')
export const emptyChildren = async (): Promise<Raw> => EMPTY_RAW

const ESCAPE_MAP: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
}

// The overwhelming majority of interpolated values contain nothing to escape, and this runs once per
// interpolation per render — per ROW inside a list. A `test()` is a scan that allocates nothing and
// returns early; the `replace()` with a callback allocates a match and invokes the callback per hit.
// So probe first and hand back the original string when there is no work to do.
const NEEDS_ESCAPE = /[&<>"']/

export function escapeHtml(value: string): string {
    if (!NEEDS_ESCAPE.test(value)) return value
    return value.replace(/[&<>"']/g, (char) => ESCAPE_MAP[char] ?? char)
}

// Interpolation value → display text (null/undefined → "", Raw → unescaped, else escaped).
export function renderValue(value: unknown): string {
    if (value === null || value === undefined) return ''
    if (value instanceof Raw) return value.value
    return escapeHtml(String(value))
}

// An interpolation LEAF's server HTML: the scalar value plus its trailing `<!---->` anchor. An
// interpolation renders TEXT — a component is invoked as a tag (`<Name/>`), which is its own paired-anchor
// slot. So a `Raw` (a rendered component subtree) arriving here is an authoring error, and a loud one:
// `renderValue` would splice the subtree unanchored, and the hydrate walk — which reads this position as a
// single text leaf — would then desync every following sibling. `templatePlan` rejects the statically
// visible form at compile time; this catches the one it cannot see, a component arriving through props.
export function renderLeaf(value: unknown): string {
    if (value instanceof Raw)
        throw new Error(
            'a component reached an interpolation — invoke a component as a tag (`<Name …/>`), not a call (`{name(…)}`)',
        )
    return `${renderValue(value)}<!---->`
}

// An `{html(...)}` region's server HTML: the raw markup BRACKETED by a collision-checked pair of comment
// anchors. The extent has to be marked rather than re-derived — a client-side re-parse of the markup
// mis-counts nodes in a context-sensitive parent (a `<td>` is dropped inside a bare probe `<div>`) and
// whenever the markup's leading text merges with the preceding sibling.
//
// The close marker must not occur INSIDE the markup, or the claim walk stops early and desyncs every
// following sibling. `html()` is raw by contract — its value can be abide's own SSR output fed back
// through it — so escalate a numeric suffix until the marker is provably absent. One `String.includes`
// on the common path, and no extra bytes unless it actually collides. Deterministic (a counter, not a
// nonce), so SSR bytes and snapshots stay stable across runs.
export function renderHtml(value: unknown): string {
    const markup = rawValue(value)
    let suffix = ''
    while (markup.includes(`<!--${HTML_ANCHOR.close}${suffix}-->`))
        suffix = suffix === '' ? '0' : `${Number(suffix) + 1}`
    return `<!--${HTML_ANCHOR.open}${suffix}-->${markup}<!--${HTML_ANCHOR.close}${suffix}-->`
}

// `{html(expr)}` value → raw markup (null/undefined → "", Raw → its value, else String). Local: the
// emitter goes through `renderHtml`, which is the only thing that may write an html region's bytes.
function rawValue(value: unknown): string {
    if (value === null || value === undefined) return ''
    if (value instanceof Raw) return value.value
    return String(value)
}

// ---------------------------------------------------------------------------
// Attribute builder (mirrors renderServer.AttributeBuilder + applyAttributeValue)
// ---------------------------------------------------------------------------

// One builder is allocated per DYNAMIC-attribute element per render, so a 1000-row list with two such
// elements per row builds 2000 of them. `values`/`classes`/`styles` are therefore created ON DEMAND —
// most elements use one of the three — and `class`/`style` membership in `order` is answered by those
// nullity checks instead of the linear `order.includes` the old version ran on every add.
export class AttributeBuilder {
    private order: string[] = []
    private values: Map<string, string | true> | null = null
    private classes: string[] | null = null
    private styles: string[] | null = null

    getValue(name: string): string | true | undefined {
        return this.values === null ? undefined : this.values.get(name)
    }

    setAttribute(name: string, value: string | true): void {
        if (name === 'class') {
            this.addClass(typeof value === 'string' ? value : name)
            return
        }
        if (name === 'style') {
            this.addStyle(typeof value === 'string' ? value : name)
            return
        }
        let values = this.values
        if (values === null) {
            values = new Map<string, string | true>()
            this.values = values
        }
        if (!values.has(name)) this.order.push(name)
        values.set(name, value)
    }

    addClass(token: string): void {
        let classes = this.classes
        if (classes === null) {
            classes = []
            this.classes = classes
            this.order.push('class') // first add reserves the slot, empty token or not
        }
        const trimmed = token.trim()
        if (trimmed !== '') classes.push(trimmed)
    }

    addStyle(declaration: string): void {
        let styles = this.styles
        if (styles === null) {
            styles = []
            this.styles = styles
            this.order.push('style')
        }
        const trimmed = declaration.trim()
        if (trimmed !== '') styles.push(trimmed.replace(/;\s*$/, ''))
    }

    serialize(): string {
        let out = ''
        for (const name of this.order) {
            // A name is only in `order` because the corresponding store was created, so each branch's
            // store is non-null here.
            if (name === 'class') {
                const merged = (this.classes as string[]).join(' ').trim()
                if (merged !== '') out += ` class="${escapeHtml(merged)}"`
            } else if (name === 'style') {
                const merged = (this.styles as string[]).join('; ').trim()
                if (merged !== '') out += ` style="${escapeHtml(merged)}"`
            } else {
                const value = (this.values as Map<string, string | true>).get(name)
                if (value === true) out += ` ${name}`
                else out += ` ${name}="${escapeHtml(value as string)}"`
            }
        }
        return out
    }
}

export function attrBuilder(): AttributeBuilder {
    return new AttributeBuilder()
}

function applyAttributeValue(builder: AttributeBuilder, name: string, value: unknown): void {
    const disposition = attributeDisposition(value)
    if (disposition.kind === 'omit') return
    builder.setAttribute(name, disposition.kind === 'bare' ? true : disposition.text)
}

export function applyStatic(builder: AttributeBuilder, name: string, value: string | null): void {
    if (value === null) builder.setAttribute(name, true)
    else builder.setAttribute(name, value)
}

export function applyExpr(builder: AttributeBuilder, name: string, value: unknown): void {
    applyAttributeValue(builder, name, value)
}

export function applyClassDir(builder: AttributeBuilder, name: string, condition: unknown): void {
    if (directiveIsOn(condition)) builder.addClass(name)
}

export function applyStyleDir(builder: AttributeBuilder, name: string, value: unknown): void {
    if (styleDirectiveApplies(value)) builder.addStyle(`${name}: ${String(value)}`)
}

// Resolve a bound value through its accessor exactly as the client `boundAccessor` does: a writable
// state (callable with `.set`) is invoked, an explicit `{ get, set }` reads via `.get()`, otherwise
// the raw value passes through (bare state vars already evaluate to their value server-side).
function resolveBound(bound: unknown): unknown {
    if (typeof bound === 'function' && typeof (bound as { set?: unknown }).set === 'function') {
        return (bound as () => unknown)()
    }
    if (bound !== null && typeof bound === 'object') {
        const object = bound as { get?: () => unknown; set?: unknown }
        if (typeof object.get === 'function' && typeof object.set !== 'undefined')
            return object.get()
    }
    return bound
}

// The ACTION half of the bind taxonomy for THIS substrate: an attribute written into an HTML string.
// Which kind a target is belongs to `bindTarget.ts`, so the client cannot answer it differently.
export function applyBind(builder: AttributeBuilder, name: string, value: unknown): void {
    switch (bindTargetKind(name)) {
        case 'element':
            // A node ref / attach fn — there is no node yet, so nothing is rendered.
            return
        case 'group': {
            // Resolve the GROUP's value and render `checked` iff it matches THIS input's own `value`
            // (the static `value` attr already sits in the builder). Never a literal `group` attribute.
            const current = resolveBound(value)
            const own = builder.getValue('value')
            const inputValue = typeof own === 'string' ? own : ''
            const isCheckbox = builder.getValue('type') === 'checkbox'
            const checked = isCheckbox
                ? Array.isArray(current) && current.includes(inputValue)
                : current === inputValue
            if (checked) builder.setAttribute('checked', true)
            return
        }
        case 'boolean':
            if (resolveBound(value)) builder.setAttribute(name, true)
            return
        default:
            applyAttributeValue(builder, name, resolveBound(value))
            return
    }
}

export function applySpread(builder: AttributeBuilder, spread: unknown): void {
    if (spread !== null && typeof spread === 'object') {
        for (const [key, value] of Object.entries(spread as Record<string, unknown>)) {
            if (isSpreadHandler(value)) continue // no live node to attach to
            applyAttributeValue(builder, key, value)
        }
    }
}
