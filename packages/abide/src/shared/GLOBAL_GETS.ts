/**
 * Every `GET` declared over a `global` value, to the value it is serving for some args.
 *
 * 21.8, 18.5 — `at(key(args))` is `undefined` where no entry holds the args. The answer reads its
 * `max-age` off it (`deadlineOf`) and its version (`versionOf`), and the mux feeds a follower from
 * it. THE KEY IS ITS OWN STEP so each side takes it once: an answer once a request, a follower once
 * as it subscribes — and the mux files its followers by it, so an entry answered reaches the
 * followers of its own args and walks no other (18.8). An unkeyed value has one entry, under `''`.
 */
export const GLOBAL_GETS = new WeakMap<
    object,
    { key(args: unknown): string; at(key: string): unknown }
>()
