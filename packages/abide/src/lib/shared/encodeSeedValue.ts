import { encodeRefJson } from './encodeRefJson.ts'

/*
The ONE degradation site for every server→client hydration seed (ADR-0048): ref-json-encode
a value bound for a warm-seed channel (await resume, cell value, doc snapshot, socket frame,
streamed-cell chunk), or drop JUST that entry with a warn naming what was dropped and what
the client does instead. encodeRefJson is total for ordinary graphs (cycles become
back-references, functions fold to undefined), so a throw is pathological — but it must
never blank the surrounding payload/stream. Funnelling every channel through here keeps the
serialize-or-degrade policy, the warn shape, and the per-kind consequence in one place
instead of seven independently-worded (or silent) drop sites.
*/
export function encodeSeedValue(
    value: unknown,
    label: string,
    consequence: string,
): string | undefined {
    try {
        return encodeRefJson(value)
    } catch (cause) {
        console.warn(`[abide] ${label} is not serializable — ${consequence}.`, cause)
        return undefined
    }
}
