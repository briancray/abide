import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'
import { allowCrossOrigin } from '../lib/policy.ts'
import { serverOnly } from '../lib/serverOnly.ts'

/* The client sees only a `remoteProxy` fetch, so the retained set is what `opts` reaches: `allowed`
   (referenced by `crossOrigin`) and its `allowCrossOrigin` import. Everything the handler alone
   touches — `json`, `serverOnly`, and the module-level `cache` — is dropped. */
const allowed = allowCrossOrigin('similar')
const cache = new Map<number, number>()

export const clientKeep = GET(
    (args: { id: number }) => {
        cache.set(args.id, serverOnly())
        return json({ id: args.id })
    },
    { crossOrigin: allowed },
)
