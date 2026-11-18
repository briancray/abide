// 53.3 — WHETHER `mod` IS ⌘, read off the user agent: the request's on a server, `navigator`'s in a
// browser, which is the same text, so a label a server renders is the one the page hydrates and the
// key a binding matches.

import { isServer } from './isServer.ts'
import { REQUEST_AGENT } from './native.ts'

const APPLE = /Mac|iPhone|iPad|iPod/

/** Whether the visitor's platform is Apple's, whose `mod` key is ⌘. */
export function isApplePlatform(): boolean {
    const agent = isServer()
        ? REQUEST_AGENT.current()
        : typeof navigator === 'undefined'
          ? ''
          : navigator.userAgent
    return APPLE.test(agent)
}
