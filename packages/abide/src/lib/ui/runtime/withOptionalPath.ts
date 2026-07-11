import { withPath } from './withPath.ts'

/* Runs `build` under the render-path segment for a compiler `ordinal`, or plainly when `ordinal`
   is undefined (a non-compiled caller that supplied no site id). Shared by the child-mount paths so
   the "push a path segment iff an ordinal is present" convention lives in one place. */
export function withOptionalPath<T>(ordinal: number | undefined, build: () => T): T {
    return ordinal === undefined ? build() : withPath(ordinal, build)
}
