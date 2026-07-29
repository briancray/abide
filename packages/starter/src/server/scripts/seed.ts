// A one-off script run by `abide run` (`bun run seed`) — CL2.
//
// `abide run` boots everything the server boots (config/env validated, rpc and socket modules
// imported, `onStart`/`onStop` wrapped around this file) and serves no HTTP. So a seed, a migration
// or a maintenance task gets exactly the environment a request handler has, minus the request: your
// pools are open, your config is validated, and `onStop` still runs when this returns.
//
// Everything after the filename belongs to THIS script, not to abide — `abide run src/server/scripts/
// seed.ts --count 5` passes `--count 5` here — and a throw propagates with its stack rather than
// becoming an exit code, because for a failed migration the stack is the report.
//
// Read the args off `process.argv`, NOT `Bun.argv`: `abide run` hands the script its argv by
// REASSIGNING `process.argv` (so `process.argv.slice(2)` means the same thing whether you go through
// abide or run the file directly), and `Bun.argv` is a fresh view of the real process argv that does
// not observe that assignment. Through `Bun.argv` this line read the script PATH instead of a flag,
// and `Number(path)` is `NaN` — which `??` does not catch, so a plain `bun run seed` printed
// "seeding NaN records".
//
// Also note this script's reads are NOT behind your middleware: the chain is installed when the app
// is BUILT to serve, and `abide run` binds no server. A migration authorizes itself.

import { log } from 'abide/shared/log'

const count = Number(process.argv[3] ?? 1)

log(`seeding ${count} record${count === 1 ? '' : 's'}…`)

// Real work goes here — the app is fully booted at this point.

log('done')
