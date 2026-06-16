// @ts-expect-error virtual module resolved by abideResolverPlugin
import cliProgramName from '../../_virtual/cli-name.ts'
import { appDataDir as appDataDirForName } from '../shared/appDataDir.ts'

/*
The running bundle's per-user data dir — keyed by the same program name abide
uses for the user's `.env` and `last-connection.json`, so an app's DB/cache lands
beside abide's own config instead of a drifted sibling directory. cwd-independent:
the path derives from the bundler-injected program name, not the process working
directory (which `open` sets to `/`). Pure: computes the path, never touches the
filesystem.
*/
// @readme reference
export function appDataDir(): string {
    return appDataDirForName(cliProgramName)
}
