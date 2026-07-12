import { log } from '../../shared/log.ts'
import type { ChannelLog } from '../../shared/types/ChannelLog.ts'
import { CURRENT_PATH } from './CURRENT_PATH.ts'

/* The `hydrate` diagnostic channel. `createChannelLog` attaches a live `enabled()` (re-read per
   call, so toggling `abide-debug` in devtools takes effect without reload) that the public
   `ChannelLog` type narrows away — reach it here in the one place that needs it. The channel is
   silent unless DEBUG/`abide-debug` matches `hydrate`. */
const hydrateChannel = log.channel('hydrate') as ChannelLog & { enabled(): boolean }

/*
Reports an SSR↔client hydration divergence on the DEBUG-gated `hydrate` channel, tagged with the
ambient render-path of the enclosing component/branch/row (`CURRENT_PATH` is coarse — it does not
descend to the individual node/attribute, so the path locates the component, the detail names the
value). Returns whether the caller should STILL THROW: with the channel off it returns `true`, so
the caller's hard throw stays the default and a real desync fails loudly; with the channel on it
warns and returns `false`, so the caller can keep hydrating and one reload surfaces EVERY
divergence instead of aborting at the first. Structural callers ignore the return (continuing past
a missing node desyncs the claim cursor) and throw regardless — the warn just names where first.
*/
export function reportHydrationDivergence(
    summary: string,
    detail: Record<string, unknown>,
): boolean {
    if (!hydrateChannel.enabled()) {
        return true
    }
    hydrateChannel.warn(`${summary} at ${CURRENT_PATH.current || '(root)'}`, detail)
    return false
}
