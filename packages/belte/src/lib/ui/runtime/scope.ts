import { OWNER } from './OWNER.ts'

/*
Runs `build` under a fresh ownership scope so every effect and listener created
inside is collected, and returns a disposer that tears them all down in reverse
order (children before parents). Save/restore of the previous owner makes scopes
nest — a list row's scope sits inside its component's scope.
*/
export function scope(build: () => void): () => void {
    const previous = OWNER.current
    const disposers: Array<() => void> = []
    OWNER.current = disposers
    try {
        build()
    } finally {
        OWNER.current = previous
    }
    return () => {
        for (let index = disposers.length - 1; index >= 0; index -= 1) {
            disposers[index]?.()
        }
        disposers.length = 0
    }
}
