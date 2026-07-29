// The header that marks a request as the abide client's, for the CSRF gate.
//
// A cross-site `<form>` can send `multipart/form-data` — it is a CORS "simple" content type — so a
// multipart mutation is admitted ONLY by this header, which a cross-site form cannot set. That makes
// three modules parties to one fact, and none of them was forced to agree with the others:
//
//   • the router's CSRF gate READS it,
//   • the CLI's mutation request WRITES it,
//   • and `cors.ts` ADVERTISES it in the default `Access-Control-Allow-Headers`.
//
// The third is the one that fails quietly. Drift there passes every same-origin test — those clear the
// gate on `content-type: application/json` and never consult the allowlist — and surfaces only as a
// browser CORS preflight failure on a cross-origin mutation, whose cause lives in a different file
// from its symptom.
//
// Named for the same reason `NAV_HEADERS` is, and in the same words: "a name spelled twice is a name
// that can drift on one side only". This was the last abide protocol header without an owner, and the
// security-critical one.
export const CSRF_HEADER = 'x-abide'
