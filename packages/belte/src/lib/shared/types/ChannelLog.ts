/*
The log shape a channel returns — the same callable + levels + trace as the
root logger, every record tagged with the channel name and emitted only when
DEBUG matches it. Levels are presentation, never gates: a channeled warn is
yellow when the channel is on and silent when it's off.
*/
export type ChannelLog = {
    (message: string, data?: unknown): void
    warn(message: string, data?: unknown): void
    error(value: unknown, data?: unknown): void
    /* Times `work`, logs `name` with the duration at settle; rethrows failures. */
    trace<Return>(name: string, work: () => Return | Promise<Return>): Promise<Return>
}
