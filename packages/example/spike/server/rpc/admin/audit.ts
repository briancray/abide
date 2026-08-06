// Nested, to pin that a subdirectory survives into the address: this is `admin/audit/recent`, so it
// is served at `/__abide/rpc/admin/audit/recent`. The path IS the address — nothing else assigns one.

import { GET } from '../../../rpc.ts'

export const recent = GET(({ limit }: { limit: number }) => ({ entries: limit }))
