/*
Percent-decodes a URL-derived value, keeping the raw text on a malformed escape
(`/%E0%A4%A`, `/%`) rather than throwing. Shared by matchRoute's param capture
and createServer's internal-route names (dev hot-module paths, socket names) so
a bad escape in a navigation or request can't crash matching/dispatch — the
downstream lookup just misses naturally on the raw text. Callers that must
fail closed on a bad escape (the asset servers 404 instead) don't use this.
*/
export function lenientDecode(value: string): string {
    try {
        return decodeURIComponent(value)
    } catch {
        return value
    }
}
