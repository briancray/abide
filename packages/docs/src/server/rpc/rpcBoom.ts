import { error } from 'abide/server/error'
import { POST } from 'abide/server/POST'

// A mutating RPC that fails with a plain `error(status, message)`. `error()` THROWS an HttpError — that
// is what puts the failure in the memo slot's error channel instead of its value channel — and the
// router renders it at 422. Called from the browser it arrives as the same HttpError, so the caller
// catches it and reads status/message either side of the wire. The success branch still types as
// `{ ok: boolean }`: a `throw` is `never`, and a union absorbs it.
export default POST(({ ok = false }) => {
    if (ok) return { ok: true }
    error(422, 'note text is required')
})
