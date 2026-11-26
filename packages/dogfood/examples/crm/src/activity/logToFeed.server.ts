import { rpc } from '@abide/abide/server'

import feed from './feed.server.ts'

const KINDS = ['Call', 'Email', 'Meeting']

/** The server writes the entry, so a caller only picks its kind. */
export default rpc(
    ({ account, kind }: { account: string; kind: string }) => {
        if (!KINDS.includes(kind)) return
        feed.patch({ account }, (entries) => {
            entries.push({
                id: crypto.randomUUID(),
                kind,
                at: new Date().toISOString().slice(11, 19),
            })
            if (entries.length > 5) entries.shift()
        })
    },
    { methods: ['POST'], description: "Adds an entry to an account's feed." },
)
