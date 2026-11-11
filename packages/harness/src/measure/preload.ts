// Registers a DOM as globals for `bun test`, and installs the measure lane's patches
// beside it. Wired from the root bunfig.toml, so it runs once per test process and
// before any suite imports. Why the patches land once rather than per case: install.ts.
import { GlobalRegistrator } from '@happy-dom/global-registrator'

import { install } from './install.ts'

// A child spawned with this env would paint its output in ANSI off a pipe (bun's console, and
// abide's own log under RULEBOOK 36.9), and the suites compare that output as text. A terminal
// that exports it made the local gate red where CI, which never sets it, stayed green.
delete process.env.FORCE_COLOR

// THE WIRE STAYS BUN'S. happy-dom registers its own `fetch` family over bun's, and those drop a
// `cookie` or `origin` header a test sets, hand a handler a `Blob` with no `bytes()`, and are refused
// by `Bun.serve`; its `WebSocket` takes none of the upgrade headers bun's does, and its
// `TransformStream` and `WritableStream` are node's `Transform` and `Writable`, not web streams. The
// DOM reaches its own through its window either way.
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
    'WebSocket',
    'TransformStream',
    'WritableStream',
] as const
const native: Record<string, unknown> = {}
for (const name of WIRE) native[name] = globalThis[name]
// 43.35 — a document a test parses names its stylesheets and scripts, and a DOM that fetched them
// would fetch them from a host nothing answers, in whichever test file happened to parse one.
// happy-dom fetches neither unless told to — a stylesheet needs `enableCSSFileLoading`, a script
// `enableJavaScriptEvaluation` — so what is set here is that a load it skipped fires `load`, as a
// fetched one would, rather than `error` and a logged `NotSupportedError`.
GlobalRegistrator.register({
    url: 'http://localhost/',
    settings: { handleDisabledFileLoadingAsSuccess: true },
})
for (const name of WIRE) Object.assign(globalThis, { [name]: native[name] })
install()
