// One component, both substrates. Nothing in here is server-only or client-only: the same `html`
// and the same primitives render to a string on the server and to live DOM in the browser.

import { html, memo, state, type TemplateResult } from 'abide'

export const count = state(0)
export const filter = state('')

// The load form: args are the cache key, so one slot per query.
export const search = memo(async ({ q }: { q: string }) => {
    await new Promise((resolve) => setTimeout(resolve, 30))
    return ['alpha', 'beta', 'gamma'].filter((word) => word.includes(q))
})

// The derive form: no args, so dependencies come from the body.
const doubled = memo(() => count() * 2)

// A promise handed to `state` is a LOAD, not a value: `session()` reads the settled thing, and the
// read below is the same call it would be if this had been `state({ name: 'guest' })`.
export const session = state(
    new Promise<{ name: string }>((resolve) => setTimeout(() => resolve({ name: 'ada' }), 20)),
)

export function App(): TemplateResult {
    return html`
        <main>
            <h1>abide</h1>
            <p>${() => (session.pending() ? 'loading…' : `hello ${session()?.name}`)}</p>
            <p class=${() => (count() > 2 ? 'high' : 'low')}>
                count ${() => count()} · doubled ${() => doubled()}
            </p>
            <button @click=${() => count.set(count.peek()! + 1)}>increment</button>
            <input .value=${() => filter()} @input=${onInput} />
            <ul>
                ${() => (search({ q: filter() })() ?? []).map((word) => html`<li>${word}</li>`)}
            </ul>
        </main>
    `
}

function onInput(event: Event): void {
    filter.set((event.target as HTMLInputElement).value)
}
