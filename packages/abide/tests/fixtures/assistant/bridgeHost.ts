#!/usr/bin/env bun
// `abide-bridge` run in a child with a deadline a test can wait out:
// `bun bridgeHost.ts <site> <code> <claude> <reply milliseconds> [<silence milliseconds>]`.

import { bridge } from '../../../../bridge/src/bridge.ts'

const [site, code, claude, reply, silence] = process.argv.slice(2) as [
    string,
    string,
    string,
    string,
    string | undefined,
]
await bridge({
    site,
    code,
    claude,
    replyMilliseconds: Number(reply),
    ...(silence === undefined ? {} : { silenceMilliseconds: Number(silence) }),
})
