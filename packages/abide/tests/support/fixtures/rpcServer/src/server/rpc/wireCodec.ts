import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'

/* Schemaless GET whose handler annotates structured arg types. The Args bag carries a Date, a
   Set<string>, a Map<string, number>, and a bigint alongside a plain string — the wire-kind
   classifier (ADR-0029) reads each off the export's call signature by symbol identity. The
   return echoes the same structured shape so the output plan can be read from the success
   body too. */
export const wireCodec = GET(
    (args: {
        when: Date
        ids: Set<string>
        counts: Map<string, number>
        big: bigint
        name: string
    }) =>
        json({
            when: args.when,
            ids: args.ids,
            counts: args.counts,
            big: args.big,
            name: args.name,
        }),
)
