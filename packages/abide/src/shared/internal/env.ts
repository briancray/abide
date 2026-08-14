// What the process was told, and the two things every reader asks it.
//
// Its own file rather than the top of `log.ts` because the answers are wanted by things that have no
// business loading a logger: `abide --help` decides whether to color a usage screen, and dragging
// `log.ts` in for a four-line read cost the binary ~6ms of the ~7ms its eager graph takes at all.

// Where the environment is, if there is one. The OBJECT is captured, not its values: `Bun.env` is a
// live view of `process.env`, so a test that sets `DEBUG` mid-run is seen by the next line.
const ENVIRONMENT: Record<string, string | undefined> =
    (globalThis as { Bun?: { env: Record<string, string | undefined> } }).Bun?.env ??
    (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ??
    {}

/** Empty string and unset are the same answer — `DEBUG=` is not a request to enable nothing. */
export function env(name: string): string | undefined {
    const held = ENVIRONMENT[name]
    return held === undefined || held === '' ? undefined : held
}

/**
 * The same read as a POSITIVE number — a size, a deadline, a ring.
 *
 * Every knob abide reads this way is one where zero and negative are not answers, so an unparseable
 * or nonsensical spelling falls back rather than disabling the thing it was meant to size. Here
 * beside `env` so the empty-is-unset rule is asked once rather than restated per reader.
 */
export function envNumber(name: string, fallback: number): number {
    const held = env(name)
    if (held === undefined) return fallback
    const parsed = Number(held)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * `NODE_ENV === 'production'`.
 *
 * Here rather than beside its reader because it is a conclusion rather than a field, and `config()`
 * publishes `NODE_ENV` VERBATIM rather than this — a document saying `production: false` while the
 * cookie was sealed as though it were true is the one lie an operator has no way to catch, so the
 * document carries the variable and the conclusion is drawn where it is acted on. Both readers are
 * `identity.ts`: the cookie's `Secure`, and the hard requirement for a signing key.
 */
export function isProduction(): boolean {
    return env('NODE_ENV') === 'production'
}

/**
 * Whether there is a terminal on the other end. A browser has no `process` and answers `false`.
 *
 * Reached per call rather than captured at load, and that is not a style choice: bun BUILDS
 * `process.stdout` on the first touch, and it costs ~6ms. Held in a module-level `const` that is
 * charged to every importer — `abide run` and `abide check` never ask this question at all.
 */
export function stdoutIsTTY(): boolean {
    return (globalThis as { process?: { stdout?: { isTTY?: boolean } } }).process?.stdout?.isTTY === true
}

/**
 * Whether anything written to this stdout may carry ANSI.
 *
 * One ordering — declared beats inferred, `NO_COLOR` beats `FORCE_COLOR` — asked by the log line's
 * shape and by the CLI's usage screen alike. They are separate DECISIONS (`ABIDE_LOG_FORMAT=json`
 * says how a machine reads records and has nothing to say about a help screen a person asked for),
 * and this is the one part of them that is the same question.
 */
export function colorAllowed(): boolean {
    if (env('NO_COLOR') !== undefined) return false
    if (env('FORCE_COLOR') !== undefined) return true
    return stdoutIsTTY()
}
