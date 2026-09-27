// 21.8, 18.20 — every `GET` declared over a `global` value, to the value it is serving for some args,
// or `undefined` where no entry holds them. The answer reads its `max-age` off it (`deadlineOf`) and
// its version (`versionOf`), and the mux feeds a follower from it.
export const GLOBAL_GETS = new WeakMap<object, (args: unknown) => unknown>()
