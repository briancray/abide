// Preloaded by `bunfig.toml` before any test file. Registering globally rather than per-suite is
// what lets a demo body run unchanged in a browser and under `bun test`: `document` is simply there.
//
// An emulator is fine for CORRECTNESS and for COUNTING work, which is what the suites assert. It is
// not fine for timing — absolute milliseconds out of happy-dom describe the emulator, not abide,
// which is why every bench arm is reported as a ratio and is run in a real browser.
import { GlobalRegistrator } from '@happy-dom/global-registrator'

// Taken BEFORE the registration overwrites it, and put back after.
//
// `register()` installs a BROWSER's `Response`, and a browser's hides `Set-Cookie` on purpose —
// script in a page may not read one. abide's server half is not a browser, so every response a
// server test built came back with the header silently dropped, and a session cookie was untestable
// in the one place it is written. That is the emulator describing itself rather than abide, the same
// way an absolute millisecond out of it does, so the real class is what stays.
//
// A browser `Request` is wrong in the same direction: `Cookie` is a forbidden header name, so one
// set on a request built here is dropped, and a server test cannot describe the caller it is testing.
//
// The line is the DATA layer, all of it or none of it: a native `Request` reading a multipart body
// built out of the emulator's `File` and `FormData` fails at `formData()` — one protocol, two
// implementations — so these seven go back together. `register()` has no opt-out, and the classes
// are reached off the global deep inside `$server`, so restoring after is the only lever there is.
//
// What stays happy-dom's is everything the DOM needs to be one: `URL`, `Event`, `AbortController`,
// `WebSocket`. That is a real seam rather than a tidy one — `new Request(url, { signal })` off a
// happy-dom `AbortController` throws, and `WireOptions.signal` is public API — but moving `Event`
// across would take happy-dom's own dispatch with it. `test/transport-wire.ts` is the lane that
// needs the rest gone, and it runs as its own process for exactly that reason.
const NATIVE = {
    Response: globalThis.Response,
    Request: globalThis.Request,
    Headers: globalThis.Headers,
    FormData: globalThis.FormData,
    File: globalThis.File,
    Blob: globalThis.Blob,
    fetch: globalThis.fetch,
}

GlobalRegistrator.register()

Object.assign(globalThis, NATIVE)
