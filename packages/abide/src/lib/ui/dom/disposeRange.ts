import type { Scope } from '../types/Scope.ts'
import { clearBetween } from './clearBetween.ts'

/*
The standard teardown for a marker-bounded range (component, layout/page boundary,
slot): dispose its lexical scope (which stops the content's reactivity first, then its
nested children and capabilities), and clear the nodes between the markers — leaving the
markers in place so a hot swap rebuilds the range. Shared by every range mount
(`fillRange`, `mountRange`, `fillBoundary`) so the one disposer contract lives in a
single place.
*/
export function disposeRange(scoped: { lexical: Scope }, start: Comment, end: Comment): () => void {
    return () => {
        scoped.lexical.dispose()
        clearBetween(start, end)
    }
}
