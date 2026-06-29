import { baseResolver } from './baseResolver.ts'

/*
Internal slot the runtime entries register their mount-base resolver into (see
baseResolver). Exposed so test helpers snapshot/poke `.resolver` and `.fallback`
directly.
*/
export const baseSlot = baseResolver.slot
