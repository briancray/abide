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

import { log } from 'abide/shared/log'

const count = Number(Bun.argv[3] ?? 1)

log(`seeding ${count} record${count === 1 ? '' : 's'}…`)

// Real work goes here — the app is fully booted at this point.

log('done')
