import { pageResolver } from './pageResolver.ts'

/*
Internal slot the runtime entries register their page resolver into (see
pageResolver). Exposed so test helpers snapshot/poke `.resolver` and
`.fallback` directly.
*/
export const pageSlot = pageResolver.slot
