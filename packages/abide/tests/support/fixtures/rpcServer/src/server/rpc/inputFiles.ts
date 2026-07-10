import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'

/* Schemaless GET whose annotated Args mix a plain field with a File. The input-schema projection
   (ADR-0030 input side) EXCLUDES the File member exactly as `filesSchema` keeps File parts out of
   the `inputSchema` projection — a File has no honest JSON-Schema form — so only `title` survives. */
export const inputFiles = GET((args: { title: string; avatar: File }) =>
    json({ ok: !!args.avatar }),
)
