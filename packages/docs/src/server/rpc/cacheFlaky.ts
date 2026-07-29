import { error } from 'abide/server/error'
import { GET } from 'abide/server/GET'

// A read that fails on demand so the `error` probe can be exercised: `{ fail: true }` throws a 400
// (the client proxy decodes it back into the HttpError the `error` probe holds), otherwise it succeeds.
export default GET(({ fail = false }) => {
    if (fail) error(400, 'flaky boom')
    return { ok: true }
})
