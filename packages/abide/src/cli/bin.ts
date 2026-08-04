#!/usr/bin/env bun
// The `abide` executable entry — thin shell over `main`. Kept minimal so all logic (and its tests)
// live in `main.ts`. `dev`/`start` keep the process alive via Bun.serve's open handles.
//
// THE ONE PLACE the dispatcher's verdict becomes a process exit code. `main` returns it (as the
// compiled surface's `runCompiledApp` always did) rather than assigning `process.exitCode` from six
// sites inside itself, so the dispatcher is a function of its argv and a test reads its result instead
// of saving, zeroing and restoring a process global.

import { main } from './main.ts'

const { exitCode } = await main(process.argv.slice(2))
// Only on failure: assigning `0` is harmless but assigning at all is what makes this the exception
// rather than the rule, and Bun ignores a later `undefined` once a number has been written.
if (exitCode !== 0) process.exitCode = exitCode
