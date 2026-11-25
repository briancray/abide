// 53.3 — WHETHER `mod` IS ⌘, read off the user agent: the request's on a server, `navigator`'s in a
// browser, which is the same text, so a label a server renders is the one the page hydrates and the
// key a binding matches. 53.3 — A SERVER ANSWERING NO REQUEST HAS NO VISITOR, and reads its own
// platform: a job in the native app labels its keys as the Mac it runs on.

import { isServer } from './isServer.ts'
import { visitorAgent } from './native.ts'

const APPLE = /Mac|iPhone|iPad|iPod/

/** Whether the visitor's platform is Apple's, whose `mod` key is ⌘. */
export function isApplePlatform(): boolean {
    const agent = visitorAgent()
    // Off `globalThis`, so a browser bundle is not handed a `process` shim for a branch it never runs.
    if (agent === '' && isServer())
        return (
            (
                globalThis as {
                    process?: { platform?: string | undefined } | undefined
                }
            ).process?.platform === 'darwin'
        )
    return APPLE.test(agent)
}
