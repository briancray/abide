import { json } from '@abide/abide/server/json'
import { POST } from '@abide/abide/server/POST'

/* A plainly-imported POST helper: the symbol query resolves its method the same as a bare
   `POST(` the regex would catch — the coverage for methodForModule on a non-aliased helper. */
export const plainPost = POST((a: { id: number }) => json(a))
