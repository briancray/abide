// THE FENCES: the four directory names that are never an address (23.15). `server` fences a graph
// (16.29), `public` is answered as authored (36.11), and `lib` and `tests` hold what is neither an
// address nor either of those. Every other directory under the root is a segment of the routes of
// the files directly in it (23.14), and holds nothing else (23.22).

/** A module under one only the server loads. */
export const SERVER_DIRECTORY = 'server'

/** A file under one is answered as authored, at the path above it. */
export const PUBLIC_DIRECTORY = 'public'

/** The app's own code that is no address: components, modules, both sides. */
export const LIB_DIRECTORY = 'lib'

/** The app's tests. */
export const TESTS_DIRECTORY = 'tests'

/** All four, as the walk of the app tests a directory against them. */
export const RESERVED_DIRECTORIES: ReadonlySet<string> = new Set([
    SERVER_DIRECTORY,
    PUBLIC_DIRECTORY,
    LIB_DIRECTORY,
    TESTS_DIRECTORY,
])
