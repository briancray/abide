import { escapeHtml } from '../../shared/escapeHtml.ts'

/*
Serializes one static text part to its markup: whitespace-only parts drop (both
back-ends omit them, so a blank part neither emits markup nor breaks a clone run),
everything else is HTML-escaped. Shared by the SSR generator and the static-clone
skeleton generator so server markup and the client clone template agree on both
the whitespace rule and escaping.
*/
export function staticTextPart(value: string): string {
    return value.trim() === '' ? '' : escapeHtml(value)
}
