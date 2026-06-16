import type { ChannelLog } from './ChannelLog.ts'

/*
The public logger: a ChannelLog on the app's own always-on channel (named
after the app, so every record carries who spoke), plus the factory for
DEBUG-gated diagnostic channels. Framework voices live on the internal
abideLog; the closing request record is emitted via internal
logClosingRecord — neither is part of this surface.
*/
export type Log = ChannelLog & {
    /* Diagnostic channel: same shape, tagged with `name`, emits only when DEBUG matches. */
    channel(name: string): ChannelLog
}
