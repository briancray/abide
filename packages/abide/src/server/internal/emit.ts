// The leaf decisions of a server render: what an attribute serialises to, what counts as a thing to
// await, and the two-line script that swaps a suspended subtree into place.
//
// The WALK stays in `$server/index.ts` — `emit` and `emitTemplate` recurse into each other, and
// separating them would buy nothing but an import cycle.

import { attributeText, escape, nonceAttribute } from '$shared/html.ts'
import { PATCH_SWAP } from '$shared/internal/MARKERS.ts'

export interface Deferred {
    id: number
    html: Promise<string>
}

/** Where an out-of-order subtree lands. Absent when a component is rendered to a plain string. */
export interface DocumentContext {
    nextId: number
    deferred: Deferred[]
}

export interface RenderContext {
    /**
     * Emit the child-slot markers a hydrating client adopts by. Off unless asked for: a marker is
     * two comments per slot, and a render nobody is going to hydrate should not pay for them or read
     * differently because of them.
     */
    hydratable: boolean
    document: DocumentContext | null
}

/** What a render with no options is. One shared object, so the walk stays monomorphic. */
export const PLAIN: RenderContext = { hydratable: false, document: null }

export interface RenderOptions {
    hydratable?: boolean
}

// The server's markup is a string, so the escaping here is the only thing between an interpolated
// value and injected markup. WHICH values are absent, bare or written comes from `attributeText`,
// shared with the client so a hydrating page writes what the server wrote.
export function attribute(name: string, value: unknown): string {
    const text = attributeText(value)
    if (text === null) return ''
    if (text === true) return ` ${name}`
    return ` ${name}="${escape(text)}"`
}

/**
 * The two-line script that swaps a deferred subtree into place, stamped for this request.
 *
 * A function rather than the constant it was, because a CSP nonce is per RESPONSE: a constant could
 * not carry one, and a hash could not stand in for it — `$p(<id>)` differs per subtree, so a
 * hash-based policy could not be written until the render finished, and running while the document
 * is still streaming is this script's entire job.
 */
export function patchScript(nonce: string | null): string {
    return `<script${nonceAttribute(nonce)}>window.$p=function(i){${PATCH_SWAP};if(t&&s){s.replaceWith(t.content);t.remove()}}</script>`
}
