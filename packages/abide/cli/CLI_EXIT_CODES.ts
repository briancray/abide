// What the shell learns from a command that ended.
//
// One table, because an exit code is an API: a script that branches on `4` is a script that breaks
// the day two builds of this disagree about what `4` meant.
//
// The codes past `2` are HTTP outcomes, and they are HTTP outcomes because the commands that talk to
// a running app are the ones a script wraps — a caller that has to grep stderr to tell "not there"
// from "not allowed" is one that will get it wrong. The mapping is deliberately COARSE: it names the
// answer a caller can act on, not the status, since a status is already in the message.

/**
 * `0` ok · `1` failed/unreachable · `2` usage · `3` 422 · `4` 401/403 · `5` 404 · `6` 504 · `7` 5xx ·
 * `8` other 4xx.
 *
 * `usage` is `2` rather than `1` for the reason it is everywhere else: a mistyped command and a
 * command that ran and failed are different things to a CI log, and only one of them is worth
 * retrying.
 */
export const CLI_EXIT_CODES = {
    ok: 0,
    /** It ran and did not work — including a wire that never answered, which is a failure with no status. */
    failed: 1,
    /** The command line itself is wrong. Nothing was attempted. */
    usage: 2,
    /** 422 — what was sent does not match the declared shape. The caller's fault, and fixable by the caller. */
    invalid: 3,
    /** 401 / 403 — this caller may not. */
    denied: 4,
    /** 404 — there is nothing at that address. */
    missing: 5,
    /** 504 — it took longer than something in the path was willing to wait. */
    timeout: 6,
    /** 5xx — the app broke. */
    server: 7,
    /** Any other 4xx. */
    client: 8,
} as const

export type CliExitCode = (typeof CLI_EXIT_CODES)[keyof typeof CLI_EXIT_CODES]

/**
 * An HTTP answer as the code the shell sees.
 *
 * A 2xx is `ok` and a 3xx is too: a redirect the fetch already followed is not an outcome, and one
 * it did not is a response the command chose not to follow — neither is a failure of the command.
 */
export function exitForStatus(status: number): CliExitCode {
    if (status < 400) return CLI_EXIT_CODES.ok
    if (status === 401 || status === 403) return CLI_EXIT_CODES.denied
    if (status === 404) return CLI_EXIT_CODES.missing
    if (status === 422) return CLI_EXIT_CODES.invalid
    if (status === 504) return CLI_EXIT_CODES.timeout
    if (status >= 500) return CLI_EXIT_CODES.server
    return CLI_EXIT_CODES.client
}
