// The two cache directives abide's own responses carry, and nothing else.
//
// A leaf because these cross from the module that reasoned about them into three others: `rpc.ts`,
// `identity.ts` and `health.ts` each spelled one of them out, and one of the four spellings was a
// `NO_STORE` that named the OTHER value in a sibling file. Four sites, two facts.
//
// `rpc.ts` and `responses.ts` want the DIRECTIVE, because they compose it into a header set through
// `headersFor`. The two endpoints want the header RECORD, and that is the whole of why one of these
// is a string and the other is an object.

/**
 * A wire answer: this caller's, and not to be written down anywhere.
 *
 * `private` as well as `no-store` because the two say different things to different hops — `private`
 * refuses a shared cache, `no-store` refuses every cache — and an rpc result is both.
 */
export const PRIVATE_NO_STORE = 'private, no-store'

/** For what is not addressed per caller: a health poll, a session document. */
const NO_STORE = 'no-store'

/**
 * That directive as the header record both of those endpoints hand to `json`.
 *
 * Here rather than beside one of them: `identity.ts` hoisted it and `health.ts` rebuilt it per poll,
 * which is a load balancer's schedule. Frozen, so neither can be handed a mutated one.
 */
export const NO_STORE_HEADER: Readonly<Record<string, string>> = Object.freeze({ 'cache-control': NO_STORE })
