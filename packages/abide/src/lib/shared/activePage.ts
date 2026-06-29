import { pageResolver } from './pageResolver.ts'
import type { PageSnapshot } from './types/PageSnapshot.ts'

/*
Resolves the active page snapshot: the registered resolver's snapshot, or a
single lazily-created empty snapshot when none is registered (so isolated tests
work). The fallback creator guarantees a value, hence the non-null assertion.
*/
export function activePage(): PageSnapshot {
    return pageResolver.get()!
}
