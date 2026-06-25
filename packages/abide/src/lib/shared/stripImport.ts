import { escapeRegex } from './escapeRegex.ts'

/*
Strips the user's `import { … } from '<moduleName>'` declaration from a
module source. Used by the $rpc / $sockets rewriters to remove the
verb / `socket` import after its call site has been replaced by the
runtime-injected binding (defineVerb / defineSocket). Without this
strip the dead import would still side-effect-load the verb/socket
helper module into the server bundle for every $rpc / $sockets file.

The braced body is `[^}]*` rather than `[\s\S]*?` so the lazy match
can't backtrack across a `}` and accidentally swallow a preceding
import whose `from` clause doesn't match (e.g. stripping
`import { GET } from '@abide/abide/server/GET'` from a file that also has
`import { json } from '@abide/abide/server/json'` on the line above). `[^}]`
includes newlines, so multi-line braced imports like
  import {
    GET,
  } from '@abide/abide/server/GET'
still match — the body just can't contain another `}` to bound it.
*/
export function stripImport(source: string, moduleName: string): string {
    const escaped = escapeRegex(moduleName)
    const pattern = new RegExp(
        `^\\s*import\\s*\\{[^}]*\\}\\s*from\\s*['"]${escaped}['"]\\s*;?\\s*$`,
        'gm',
    )
    return source.replace(pattern, '')
}
