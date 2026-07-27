import { GET } from 'abide/server/GET'

// A tiny read RPC used by the control-flow "async reads" page: a bare `{await controlGreet(...)}`
// interpolation resolves this value during SSR so the greeting lands directly in the initial HTML.
//
// The run counter is what makes the demo's "Run again" button OBSERVABLE. A memo hands the previous
// state object back when a re-fill is identity-equal, so a handler returning a fixed string would
// refresh, re-fetch, and wake nobody — the button would be a silent no-op and the page would appear
// to demonstrate something it does not.
let runs = 0

export default GET(({ who = 'reader' }) => {
    runs++
    return `Hello, ${who} — resolved on the server (run ${runs}).`
})
