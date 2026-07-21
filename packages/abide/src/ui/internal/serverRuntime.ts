// SERVER RUNTIME for emitted `.abide` server modules (Stage 1, PR3) — BUILD/SSR-SIDE ONLY.
//
// The string-building + attribute-serialization helpers the emitted `render($scope)` module calls.
// Deliberately lifted VERBATIM from the `renderServer.ts` interpreter (escaping rules, boolean/omit
// rules, class/style merge order, `Raw` handling) so emitted server output matches the interpreter
// byte-for-byte (modulo comment anchors). This never ships to the browser.

// Re-exported so the emitted server `{#for await}` can flip the `done(source)` probe when it fully
// drains a stream within the SSR pass (see emitServer.ts).
export { markIterableDone } from '../../shared/internal/iterableDone.ts'

// Streaming SSR: the emitted streaming `{#await}` block calls `$rt.awaitStream(...)` (PR2 — deadline
// race, render inline if fast, defer + placeholder if slow); the streaming `{#for await}` block calls
// `$rt.forAwaitStream(...)` (PR6 — drain to the deadline inline, then append items into an `<abide-list>`
// as they stream). See `streamScope.ts`.
export { awaitStream, forAwaitStream } from './streamScope.ts'

// Marks already-safe HTML that must NOT be escaped (snippet calls / `{children()}` slot).
export class Raw {
    constructor(readonly value: string) {}
    toString(): string {
        return this.value
    }
}

const ESCAPE_MAP: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
}

export function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => ESCAPE_MAP[char] ?? char)
}

// Interpolation value → display text (null/undefined → "", Raw → unescaped, else escaped).
export function renderValue(value: unknown): string {
    if (value === null || value === undefined) return ''
    if (value instanceof Raw) return value.value
    return escapeHtml(String(value))
}

// `{html(expr)}` value → raw markup (null/undefined → "", Raw → its value, else String).
export function rawValue(value: unknown): string {
    if (value === null || value === undefined) return ''
    if (value instanceof Raw) return value.value
    return String(value)
}

// ---------------------------------------------------------------------------
// Attribute builder (mirrors renderServer.AttributeBuilder + applyAttributeValue)
// ---------------------------------------------------------------------------

export class AttributeBuilder {
    private order: string[] = []
    private values = new Map<string, string | true>()
    private classes: string[] = []
    private styles: string[] = []

    getValue(name: string): string | true | undefined {
        return this.values.get(name)
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
        if (!this.values.has(name)) this.order.push(name)
        this.values.set(name, value)
    }

    addClass(token: string): void {
        if (!this.order.includes('class')) this.order.push('class')
        if (token.trim() !== '') this.classes.push(token.trim())
    }

    addStyle(declaration: string): void {
        if (!this.order.includes('style')) this.order.push('style')
        if (declaration.trim() !== '') this.styles.push(declaration.trim().replace(/;\s*$/, ''))
    }

    serialize(): string {
        let out = ''
        for (const name of this.order) {
            if (name === 'class') {
                const merged = this.classes.join(' ').trim()
                if (merged !== '') out += ` class="${escapeHtml(merged)}"`
            } else if (name === 'style') {
                const merged = this.styles.join('; ').trim()
                if (merged !== '') out += ` style="${escapeHtml(merged)}"`
            } else {
                const value = this.values.get(name)
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
    if (value === false || value === null || value === undefined) return // omit
    if (value === true) {
        builder.setAttribute(name, true)
        return
    }
    builder.setAttribute(name, String(value))
}

export function applyStatic(builder: AttributeBuilder, name: string, value: string | null): void {
    if (value === null) builder.setAttribute(name, true)
    else builder.setAttribute(name, value)
}

export function applyExpr(builder: AttributeBuilder, name: string, value: unknown): void {
    applyAttributeValue(builder, name, value)
}

export function applyClassDir(builder: AttributeBuilder, name: string, condition: unknown): void {
    if (condition) builder.addClass(name)
}

export function applyStyleDir(builder: AttributeBuilder, name: string, value: unknown): void {
    if (value !== false && value !== null && value !== undefined)
        builder.addStyle(`${name}: ${String(value)}`)
}

// Resolve a bound value through its accessor exactly as the client `boundAccessor` does: a writable
// signal (callable with `.set`) is invoked, an explicit `{ get, set }` reads via `.get()`, otherwise
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

export function applyBind(builder: AttributeBuilder, name: string, value: unknown): void {
    // `bind:element` is a CLIENT-ONLY node ref / attach fn — it renders no server attribute.
    if (name === 'element') return
    // `bind:group` is a radio/checkbox membership bind — resolve the group value and render `checked`
    // iff it matches THIS input's own `value` (the static `value` attr already sits in the builder).
    // It never emits a literal `group` attribute. Mirrors client `bindGroup`.
    if (name === 'group') {
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
    const resolved = resolveBound(value)
    if (name === 'checked' || name === 'selected') {
        if (resolved) builder.setAttribute(name, true)
    } else {
        applyAttributeValue(builder, name, resolved)
    }
}

export function applySpread(builder: AttributeBuilder, spread: unknown): void {
    if (spread !== null && typeof spread === 'object') {
        for (const [key, value] of Object.entries(spread as Record<string, unknown>)) {
            if (typeof value === 'function') continue // drop handlers server-side
            applyAttributeValue(builder, key, value)
        }
    }
}
