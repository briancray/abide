/**
 * Every `GET` declared over a `global` value, to the value it is serving for some args.
 *
 * 21.8, 18.5 — `undefined` where no entry holds the args. The answer reads its `max-age` off it
 * (`deadlineOf`) and its version (`versionOf`), and the mux feeds a follower from it.
 */
export const GLOBAL_GETS = new WeakMap<object, (args: unknown) => unknown>()
