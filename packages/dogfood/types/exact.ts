// Type-level assertions, so a passing typecheck means what it looks like it means.
//
// A green `tsc` proves nothing on its own. If the desugar started emitting `any` — a cell read that
// lost its type, a prop that stopped being checked, a narrowing that collapsed — every file in this
// repo would still compile, every test would still pass, and the whole typing contract would be gone
// with nothing to report it. `any` is assignable to everything, which is exactly why an assignability
// check cannot catch it.
//
// So the assertions here are about IDENTITY rather than assignability. `Exact` is the standard
// conditional-type trick: two types are the same iff a generic function returning `1 | 2` over each
// is mutually assignable, which `any` fails on both sides. That is the one comparison `any` cannot
// pass by being permissive.
//
// This is the same argument the harness already makes about work: a correctness test cannot guard a
// contract about how something is DONE, so the contract has to be asserted directly. A type is that.

/**
 * `true` only when `A` and `B` are the SAME type — not merely assignable, which `any` always is and
 * which a widened type usually is too.
 */
export type Exact<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

/**
 * The assertion. `assertType<Exact<typeof x, string>>()` is an ordinary call that only type-checks
 * when the claim holds, so a drift is a compile error at the line that claimed it.
 */
export function assertType<_Claim extends true>(): void {}

/** The negative form, for a claim that two types must NOT be the same. */
export function assertNotType<_Claim extends false>(): void {}
