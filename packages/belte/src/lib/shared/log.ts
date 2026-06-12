import { appNameSlot } from './appNameSlot.ts'
import { createChannelLog } from './createChannelLog.ts'
import type { ChannelLog } from './types/ChannelLog.ts'
import type { Log } from './types/Log.ts'

/*
The unified logger: every record carries the request-scope context (short
trace id, +elapsed, verb+path) when one is active, plus a channel — the
line's speaker. `log(...)`/`warn`/`error`/`trace` speak on the app's own
always-on channel (the app name, resolved per emission so boot order doesn't
matter); `log.channel(name)` returns the same shape on a DEBUG-gated
diagnostic channel (browser: the `belte-debug` localStorage key). Renders as
the tab-separated tsv format (default) or one JSON object per line under
BELTE_LOG_FORMAT=json.
*/
export const log: Log = Object.assign(
    createChannelLog(() => appNameSlot.name ?? 'app', true),
    {
        channel(name: string): ChannelLog {
            return createChannelLog(() => name, false)
        },
    },
)
