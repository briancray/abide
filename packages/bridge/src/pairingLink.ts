// A PAIRING AS A LINK: what a site shows beside its command (44.40), opened by the handler
// `abide-bridge install` registers. It carries what the command does — the site, the code, the bridge
// release that speaks the site's relay and the built-in tools it asks for — and nothing more, and the
// handler asks the visitor before it runs one (44.42).

// abide's `BRIDGE_SCHEME`, spelled out for `BRIDGE_PATH`'s reason — a test holds the two equal.
export const PAIRING_SCHEME = 'abide-bridge'

/** One pairing a link asks for. */
export type Pairing = {
    site: string
    code: string
    version: string
    tools: string[]
}

// A release on npm, never a range, a tag or a path: the version is laid into `bun x`'s package spec.
const RELEASE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
// abide's codes are base64url.
const CODE = /^[\w-]+$/
// A tool as `--tools` names one: `WebSearch`, `Bash`.
const TOOL = /^[A-Za-z][A-Za-z0-9]*$/
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * The pairing `link` asks for, or `undefined` where it is not one this bridge opens: another scheme,
 * a site that is neither https nor loopback, or any part that would be read as more than it is. 44.41.
 */
export function pairingOf(link: string): Pairing | undefined {
    let url: URL
    try {
        url = new URL(link)
    } catch {
        return undefined
    }
    if (url.protocol !== `${PAIRING_SCHEME}:` || url.host !== 'pair')
        return undefined
    const site = url.searchParams.get('site') ?? ''
    const code = url.searchParams.get('code') ?? ''
    const version = url.searchParams.get('version') ?? ''
    const tools = (url.searchParams.get('tools') ?? '')
        .split(',')
        .filter((tool) => tool !== '')
    let siteUrl: URL
    try {
        siteUrl = new URL(site)
    } catch {
        return undefined
    }
    const secure =
        siteUrl.protocol === 'https:' ||
        (siteUrl.protocol === 'http:' && LOOPBACK.has(siteUrl.hostname))
    if (
        !secure ||
        siteUrl.username !== '' ||
        siteUrl.password !== '' ||
        siteUrl.search !== '' ||
        siteUrl.hash !== '' ||
        !CODE.test(code) ||
        !RELEASE.test(version)
    )
        return undefined
    for (const tool of tools) if (!TOOL.test(tool)) return undefined
    return {
        site: `${siteUrl.origin}${siteUrl.pathname}`.replace(/\/+$/, ''),
        code,
        version,
        tools,
    }
}
