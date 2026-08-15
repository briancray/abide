// A nested module, so the address keeps its subdirectory: `admin/audit/recent`.

import { GET } from 'abide/server'

export const recent = GET(({ limit }: { limit: number }) => ({ entries: limit }))
