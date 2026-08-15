import { isPending, memo } from 'abide'

const user = memo(async ({ id }: { id: number }) => ({ id, name: `user ${id}` }))

/**
 * The one predicate an author needs about a read with nothing to serve YET.
 *
 * A read that has not landed signals by THROWING, and a JavaScript `catch` is total — so a try/catch
 * written for the failures catches that signal too, and swallowing it turns "the graph will run this
 * again" into an error that never clears. `isPending` is how a `catch` hands it back.
 */
export function nameOrTrouble(id: number): string {
    try {
        return user({ id })().name
    } catch (thrown) {
        if (isPending(thrown)) throw thrown
        return 'could not load'
    }
}
