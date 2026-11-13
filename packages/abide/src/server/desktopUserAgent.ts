import { DESKTOP_AGENT } from '#shared/DESKTOP_AGENT.ts'

// WebKit's own macOS user agent, frozen since Safari 14 so a site cannot read the system from it.
// Written out rather than read from the view because `applicationNameForUserAgent`, the API that
// appends to it, is read only by `initWithFrame:configuration:`, whose `NSRect` argument `bun:ffi`
// cannot pass by value on every architecture.
const WEBKIT_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'

/** The user agent a desktop app's window sends, naming the version of the `.app` (38.140). */
export function desktopUserAgent(version: string): string {
    return `${WEBKIT_AGENT} ${DESKTOP_AGENT}/${version}`
}
