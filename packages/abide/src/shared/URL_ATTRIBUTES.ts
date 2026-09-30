/**
 * The attributes a URL is written into, whose values are scheme-checked.
 *
 * 32.20 — THE ATTRIBUTES A URL IS WRITTEN INTO, which a value is scheme-checked on its way into —
 * by name in the compiler, and through a spread at run time. A leaf, because both seams read it.
 */
export const URL_ATTRIBUTES: ReadonlySet<string> = new Set([
    'href',
    'xlink:href',
    'src',
    'action',
    'formaction',
    'poster',
    'cite',
    'ping',
    'data',
    'manifest',
    'background',
])
