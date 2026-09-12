// EVERY PATH THE STATUS PAGE ASKS FOR, in one place, so the page and the server are
// joined by a list rather than by two people remembering. `statusPage.test.ts` reads
// it in both directions: an endpoint nothing asks for, and a request nothing answers.
// The second is the one that ships silently — the page renamed `/api/measure` to
// `/api/bench` and the server went on offering the old one, so the panel fetched a
// 404 and rendered "not run yet" forever.
//
// `/api/suites` is the LISTING and runs nothing: the page draws every suite row on
// load, so a table is the shape of the suite before it is a report on one. It is the
// only endpoint here a reader does not press a button to reach.
//
// A leaf, with no imports of its own, and that is what it is FOR as much as a
// convention: the test that gates the join would otherwise import the module that
// drives playwright over a browser to get at a list of six strings.
export const STATUS_ENDPOINTS = [
    '/api/suites',
    '/api/run/unit',
    '/api/run/gates',
    '/api/run/browser',
    '/api/bench',
    '/api/bench/reactive',
    '/api/counted',
    '/api/machinery',
] as const
