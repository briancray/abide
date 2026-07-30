import type { MuxDownstream } from './muxDownstream.ts'

// One inbound WS-mux frame, narrowed. `data` carries a message, `ack` is the subscribe acknowledgement,
// `error` is the subscribe rejection — the three shapes `MuxDownstream` declares, distinguished the way
// that type distinguishes them: by which field is present.
export type ParsedMuxFrame =
    | { kind: 'data'; name: string; args: unknown; msg: unknown }
    | { kind: 'ack'; name: string; args: unknown }
    | { kind: 'error'; name: string; args: unknown; error: unknown }

// Parse + narrow one downstream frame; `null` for anything unroutable (bad JSON, no `name`).
//
// The CONSUMER half of `MuxDownstream`, shared by every consumer there is: the browser mux
// (`ui/internal/mux.ts`) and the test app's socket client (`test/createTestApp.ts`). Each used to carry
// its own copy of the same loose-superset-then-narrow-by-field ladder, which meant the test harness —
// the one surface whose job is to catch protocol drift — was running a second implementation of the
// protocol it was supposed to be checking. A field rename now breaks one function.
//
// Deliberately loose about the payload: this is UNTRUSTED JSON off the wire, so it reads a superset
// shape and narrows by presence rather than validating. `MuxDownstream` is the contract it documents;
// the producer (`server/internal/router.ts`) stamps every send `satisfies MuxDownstream`, which is what
// makes a field rename a compile error on the sending side.
export function parseMuxFrame(raw: string): ParsedMuxFrame | null {
    let framed: { name?: unknown; args?: unknown; msg?: unknown; ok?: unknown; error?: unknown }
    try {
        framed = JSON.parse(raw)
    } catch {
        return null
    }
    if (framed === null || typeof framed !== 'object') return null
    const name = framed.name
    if (typeof name !== 'string') return null
    // Order matters and mirrors `MuxDownstream`'s union order: a control frame is decided before the
    // data frame, because a `msg`-less data frame and an ack are otherwise indistinguishable.
    if (framed.error !== undefined)
        return { kind: 'error', name, args: framed.args, error: framed.error }
    if (framed.ok === true) return { kind: 'ack', name, args: framed.args }
    return { kind: 'data', name, args: framed.args, msg: framed.msg }
}

// Compile-time proof that the three parsed kinds cover `MuxDownstream`'s three shapes: a fourth member
// added there stops type-checking HERE rather than being parsed as `data` with `msg: undefined` and
// routed by both the browser mux and `createTestApp` — the harness whose job is catching protocol drift.
//
// Through `Assert`, which is what makes it a proof. It was written as a bare conditional whose false
// branch was `never`, and that is not a diagnostic: an unsatisfied conditional simply EVALUATES to
// `never`, the alias was referenced nowhere, and the file compiled either way. A comment claiming an
// invariant the code does not enforce is the exact class this repo has been finding — see CONTEXT.md's
// "Owner" entry — and a totality proof that proves nothing is the most expensive kind, because it is
// read as coverage.
type Assert<T extends true> = T
type _ExhaustiveOverDownstream = Assert<
    MuxDownstream extends { msg: unknown } | { ok: true } | { error: unknown } ? true : false
>
