import { memo } from '@abide/abide'

import { askRegistry } from './askRegistry.server.ts'

/** Each company's registry entry, asked again an hour after the last answer while a page reads it; an ask that fails keeps the last answer. */
export const registrations = memo(({ id }: { id: string }) => askRegistry(id), {
    global: true,
    ttl: 3_600_000,
})
