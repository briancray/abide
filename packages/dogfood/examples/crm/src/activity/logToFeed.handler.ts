import { POST } from '@abide/abide/server'

import { feeds } from './lib/feeds.ts'

const KINDS = ['Call', 'Email', 'Meeting']

/** The server writes the entry, so a caller only picks its kind. */
export default POST(
    ({ account, kind }: { account: string; kind: string }) => {
        if (!KINDS.includes(kind)) return
        feeds({ account }).patch((entries) => {
            entries.push({
                id: crypto.randomUUID(),
                kind,
                at: new Date().toISOString().slice(11, 19),
            })
            if (entries.length > 5) entries.shift()
        })
    },
    { description: "Adds an entry to an account's feed." },
)
