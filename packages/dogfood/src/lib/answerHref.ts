import { siteHref } from './inline.ts'

const SCHEMED = /^[a-zA-Z][a-zA-Z\d+.-]*:/

/**
 * 40.29 — where a link the model wrote goes: a page of the site below its mount, an anchor, or an
 * address on a scheme `markdown` already let through. A path relative to nothing is no link.
 */
export function answerHref(address: string): string | undefined {
    if (SCHEMED.test(address) || address.startsWith('//')) return address
    if (address.startsWith('#') || address.startsWith('/'))
        return siteHref(address)
    return undefined
}
