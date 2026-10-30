// Registers a DOM as globals for `bun test`, and installs the measure lane's patches
// beside it. Wired from the root bunfig.toml, so it runs once per test process and
// before any suite imports.
//
// The patches land HERE rather than around a case body. Removing them per case cannot
// be done in the browser arm at all — `addInitScript` runs at document-start and has
// no removal hook — and re-patching per case invalidates the inline caches on those
// members once per case, for the process. `arm()`/`disarm()` swap the record instead,
// so the prototype shape is fixed for the process lifetime.
import { GlobalRegistrator } from '@happy-dom/global-registrator'

import { install } from './install.ts'

// A child spawned with this env would paint its output in ANSI off a pipe (bun's console, and
// abide's own log under RULEBOOK 36.9), and the suites compare that output as text. A terminal
// that exports it made the local gate red where CI, which never sets it, stayed green.
delete process.env.FORCE_COLOR

// THE WIRE STAYS BUN'S. happy-dom registers its own `fetch` family over bun's, and those drop a
// `cookie` or `origin` header a test sets, hand a handler a `Blob` with no `bytes()`, and are refused
// by `Bun.serve`. The DOM reaches its own through its window either way.
const WIRE = [
    'fetch',
    'Request',
    'Response',
    'Headers',
    'Blob',
    'File',
    'FormData',
    'AbortController',
    'AbortSignal',
] as const
const native: Record<string, unknown> = {}
for (const name of WIRE) native[name] = globalThis[name]
GlobalRegistrator.register({ url: 'http://localhost/' })
for (const name of WIRE) Object.assign(globalThis, { [name]: native[name] })
install()
