// The exit codes a compiled binary reports (machine-surfaces.md MS3.4: "errors → stderr + non-zero
// exit; typed errors → structured stderr shape + distinct exit codes").
//
// A shell script branching on `$?` needs to distinguish "I called it wrong" from "the server said no"
// from "the server broke", so the codes are keyed to the FAILURE CLASS rather than to the HTTP status
// (which the structured stderr payload already carries verbatim, `status` and typed-error `name`
// included). App-defined typed errors deliberately do NOT get codes of their own: their names are the
// app's vocabulary, not abide's, and a per-name code would change meaning between two apps.
export const CLI_EXIT_CODES = {
    ok: 0,
    // The call never produced an answer — connection refused, DNS, an aborted stream.
    failed: 1,
    // The COMMAND LINE was wrong: unknown subcommand, unknown flag, missing required arg. Nothing was
    // sent, so nothing happened.
    usage: 2,
    // 422 — the args reached the server and its schema rejected them (ValidationErrorData on stderr).
    validation: 3,
    // 401 / 403 — authenticate (`--token` / `ABIDE_APP_TOKEN`) or you are not permitted.
    unauthorized: 4,
    // 404 — no such route on the target. Reachable in remote mode against an older deployment.
    notFound: 5,
    // 504 — the run deadline tripped (ADR 0028); the work may still be running server-side.
    timeout: 6,
    // Any other 4xx.
    clientError: 8,
    // Any 5xx — the handler threw.
    serverError: 7,
} as const
