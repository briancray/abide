/*
Window form of `tail()`: `last` is the rolling window size — the reader holds
the last ≤`last` frames, however they arrived. A source that retains a tail
(a socket declared with `{ tail: n }`) seeds the window by replaying up to
`last` retained frames; a source with no retention (an rpc stream, an
undeclared socket) fills it from live frames only. Integer ≥ 1.
*/
export interface TailOptions {
    readonly last: number
}
