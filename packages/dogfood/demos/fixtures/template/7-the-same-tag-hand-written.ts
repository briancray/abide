import { html, type TemplateResult } from 'abide'

/**
 * The same row component with the compiler taken out.
 *
 * `html` is the ONE name on both sides of the authored/emitted line: the compiler writes this tag for
 * a `.abide` file, and a hand-written `.ts` component writes the same one. So the two are the same
 * kind of value, and either can sit in the other's `{#for row of rows by row}`.
 *
 * What the compiler was doing is now visible — a prop is an ordinary parameter, and a slot that must
 * re-read is a THUNK. `${row}` below is read once; `${() => row}` would be a subscription.
 */
export function Row(args: { row?: string; children?: unknown }): TemplateResult {
    const { row = 'alpha' } = args
    return html`<li>${row}</li>`
}
