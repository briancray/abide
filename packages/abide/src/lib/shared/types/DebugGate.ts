/*
The two questions a DEBUG string answers for one channel name. `enabled` gates a
diagnostic channel (inclusion, with exclusions winning); `negated` is the off
switch for always-on channels (a `-name` pattern silencing the app's own or
abide's framework voice). Returned by debugGate, already bound to one env value.
*/
export type DebugGate = {
    enabled(name: string): boolean
    negated(name: string): boolean
}
