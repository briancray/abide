// THE STATUS BITFIELD AND THE DIRTY SCALE, and they are two different things in one
// leaf — a constant crossing a seam lives in its own UPPERCASE file with no imports
// of its own (CLAUDE.md, "seams and imports"), and both of these cross.
//
// A subscription is a MASK over the bits below and `link.mask & changed` decides
// WHETHER an edge wakes. It does not decide at what LEVEL: taking the level from the
// masked XOR made `CHECK` resolvable only against a source's `version`, `version`
// moves only on a value production, and so no probe transition could ever validate —
// `s.set(fetchUser())` set `PENDING`, notified `CHECK`, found the version unmoved and
// dropped the reader back to clean with the spinner never shown. The mask is a
// summary of a transition; `version` is a token for a value. See `graph.ts`.

export const PENDING = 1
export const REFRESHING = 2
export const DONE = 4
export const SUCCESS = 8
export const STREAMING = 16
// The standing `s.error` — 4.10, 4.11. Set by a refused write and by a failed
// producer alike, and orthogonal to `SUCCESS` per 3.10.
export const ERRORED = 32
// 2.3 makes a read THROW where a producer failed and nothing has landed; 2.4 and 2.5
// say a rejected write and a failed revalidation do not. One bit cannot answer both
// questions, so the throw has a bit of its own.
export const PRODUCER_FAILED = 64
export const STALE = 128
// Never stored. Only ever in a `changed` mask, and in the mask an edge subscribes
// with — the VALUE channel is the one whose token is `version` rather than `pulse`.
export const VALUE = 256
export const PROPAGATED = PENDING | REFRESHING | DONE // 11.20

// The dirty LEVELS. Not status bits and never in a mask — a separate scale, in the
// same leaf for the same seam-crossing reason. DIRTY/CHECK is the DIRECT/TRANSITIVE
// axis the two-colour walk is for: an edge woken on a bit it explicitly subscribed to
// is by definition DIRTY, and a memo pushes CHECK onward to its own subscribers.
export const CLEAN = 0
export const CHECK = 1
export const DIRTY = 2

// IN FLIGHT is what a settle of any kind ends, and it is cleared on FOUR paths rather
// than one: an accepted production, a refused one, a rejection, and a duplicate. A
// single `CLEARED_BY_A_PRODUCTION` applied in `produce` alone left both refusal paths
// returning before they reached it, so a load whose payload the schema rejected kept
// `PENDING` set for the life of the node — the spinner spinning with the error
// already in `s.error`. Only an ACCEPTED production also clears `STALE` and the error
// pair.
export const IN_FLIGHT = PENDING | REFRESHING | STREAMING
export const CLEARED_BY_A_PRODUCTION =
    IN_FLIGHT | STALE | ERRORED | PRODUCER_FAILED
// The same VALUE as `IN_FLIGHT` and a different QUESTION, which a duplicate-export
// check reads as one name too many. `IN_FLIGHT` is what a probe asks the status; this
// is what 4.15 says a settle clears. They are equal today and 4.15 is what would move
// one of them.
export const CLEARED_BY_A_SETTLE = IN_FLIGHT
