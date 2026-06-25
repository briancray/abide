import { describe, expect, test } from 'bun:test'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import { state } from '../src/lib/ui/state.ts'

/* Runs a compiled SSR body, returning { html, state }. No DOM — pure string. */
function render(source: string): { html: string; state: unknown } {
    const body = compileSSR(source)
    return new Function('doc', 'state', 'computed', 'effect', body)(
        doc,
        state,
        computed,
        effect,
    ) as {
        html: string
        state: unknown
    }
}

describe('compileSSR — server render to string', () => {
    test('renders interpolation, list, and conditional to HTML; serializes state', () => {
        const result = render(`
            <script>
                let count = scope().state(2)
                let items = scope().state(['a', 'b'])
                let label = scope().computed(() => 'n=' + count)
            </script>
            <button onclick={() => count += 1}>+</button>
            <p>{label}</p>
            <ul>
                {#for it of items by it}
                    <li>{it}</li>
                {/for}
            </ul>
            {#if count}
                <small>nonzero</small>
            {/if}
        `)
        expect(result.html).toBe(
            '<button>+</button><p>n=2</p><ul><!--a--><!--[--><li>a</li><!--]--><!--[--><li>b</li><!--]--></ul><!--[--><small>nonzero</small><!--]-->',
        )
        expect(result.state).toEqual({ count: 2, items: ['a', 'b'] })
    })

    test('a falsy if renders an empty range', () => {
        const result = render(`
            <script>let show = scope().state(false)</script>
            {#if show}<span>hi</span>{/if}
        `)
        // the `when` range markers are always present; the false branch is empty
        expect(result.html).toBe('<!--[--><!--]-->')
    })

    test('dynamic values are HTML-escaped', () => {
        const result = render(`
            <script>let name = scope().state('<b>&"')</script>
            <p>{name}</p>
        `)
        expect(result.html).toBe('<p>&lt;b&gt;&amp;&quot;</p>')
    })

    test('bind:value renders the current value as an attribute', () => {
        const result = render(`
            <script>let draft = scope().state('hello')</script>
            <input bind:value={draft}>
        `)
        expect(result.html).toBe('<input value="hello">')
    })

    test('a dynamic attribute follows present/absent boolean semantics', () => {
        const off = render(`
            <script>let busy = scope().state(false)</script>
            <button disabled={busy}>go</button>
        `)
        expect(off.html).toBe('<button>go</button>') // false → attribute omitted, not disabled="false"
        const on = render(`
            <script>let busy = scope().state(true)</script>
            <button disabled={busy}>go</button>
        `)
        expect(on.html).toBe('<button disabled>go</button>') // true → bare attribute
    })

    test('static attribute values are HTML-escaped', () => {
        const result = render(`<a data-json='{"x":1}' title="a & b">link</a>`)
        expect(result.html).toBe('<a data-json="{&quot;x&quot;:1}" title="a &amp; b">link</a>')
    })
})
