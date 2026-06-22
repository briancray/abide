import { escapeHtml } from '../../shared/escapeHtml.ts'

/*
Serializes one static attribute to its markup fragment, leading space included.
Shared by the SSR generator and the static-clone skeleton generator so the two
back-ends can't diverge on attribute byte-shape or value escaping — the contract
that lets the client clone template hydrate the server markup.
*/
export function staticAttr(name: string, value: string): string {
    return ` ${name}="${escapeHtml(value)}"`
}
