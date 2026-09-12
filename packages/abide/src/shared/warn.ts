// THE WARNING CHANNEL, standing in for group 28 until it lands. 28.9 has a
// correctness failure report on a channel `abide:` names — `abide:refuse`,
// `abide:reactive`, `abide:watch` are the three this seam writes to — and 28.1 has
// every line published to `log.records`, which is an ordinary `Room`. A `Room` is
// phase 8 of `REACTIVE.md` and the refusals it would carry are phase 0b, so the
// logger cannot be the thing the refusals depend on.
//
// This is the one call site group 28 replaces, rather than nineteen `console.warn`s
// spread across the seam. It goes when `log.channel` lands.
export function warn(channel: string, ...args: unknown[]): void {
    console.warn(`${channel}`, ...args)
}
