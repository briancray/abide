// 32.37 — WHAT A VALUE WRITES INTO AN ATTRIBUTE, the one answer the server's markup, a client
// binding, a row built in the browser and a `{...expr}` spread all take. `null` is the attribute
// ABSENT: for `null` and `undefined` everywhere, and for a falsy value on an attribute HTML reads by
// presence. A URL attribute's text is scheme-checked here too (32.20), after the absence is decided
// — `safeUrl(undefined)` is `''`, which would have written an empty `href` where none was asked for.
// And WARNED HERE, the one place that has both the interpolation and the attribute's name: a
// literal the compiler drops never reaches it.

import { BOOLEAN_ATTRIBUTES } from './BOOLEAN_ATTRIBUTES.ts'
import { escapeAttribute } from './escapeText.ts'
import { RENDER_LOG } from './log.ts'
import { textOf } from './Raw.ts'
import { safeUrl } from './safeUrl.ts'
import { URL_ATTRIBUTES } from './URL_ATTRIBUTES.ts'

/**
 * The text a value writes into an attribute, or `null` for the attribute absent.
 *
 * The name as the element carries it; both leaves hold the folded form, and an SVG attribute keeps
 * its case on the element (`viewBox`), so the fold is for the lookup alone.
 */
export function attributeText(name: string, value: unknown): string | null {
    if (value === null || value === undefined) return null
    const folded = name.toLowerCase()
    // PRESENT BY TRUTHINESS, and a string that made it present is its text: `hidden` reads
    // `until-found`, where the presence alone would hide the content from find-in-page for good.
    if (BOOLEAN_ATTRIBUTES.has(folded))
        return value ? (typeof value === 'string' ? value : '') : null
    const text = textOf(value)
    if (!URL_ATTRIBUTES.has(folded)) return text
    const safe = safeUrl(text)
    if (safe !== text)
        RENDER_LOG.warning(
            `abide: \`${name}\` was handed a URL whose scheme is not http:, https:, mailto: or tel:, and is written empty. RULEBOOK 32.20.`,
        )
    return safe
}

/** The same answer as the bytes the server's tag carries, leading space included, or nothing. */
export function attributeMarkup(name: string, value: unknown): string {
    return writtenMarkup(name, attributeText(name, value))
}

/** Text `attributeText` already answered, as those bytes — which a spread holds once per entry. */
export function writtenMarkup(name: string, text: string | null): string {
    if (text === null) return ''
    if (text === '' && BOOLEAN_ATTRIBUTES.has(name.toLowerCase()))
        return ` ${name}`
    return ` ${name}="${escapeAttribute(text)}"`
}
