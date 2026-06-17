import { appDataDir } from '@abide/abide/server/appDataDir'
import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'

/*
Reports the running app's per-user data dir. `appDataDir()` keys off the
bundler-injected program name (not cwd), so a bundle's DB/cache lands beside
abide's own .env and last-connection.json instead of a drifted sibling. Pure —
it computes the path, never touches the filesystem; the bundle page reads it
to show where state would live.
*/
export const getDataDir = GET<undefined, { dir: string }>(() => json({ dir: appDataDir() }))
