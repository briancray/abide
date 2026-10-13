// THE TWO DIRECTORY NAMES THAT ARE NEVER AN ADDRESS (23.15): `server` fences a graph (16.29) and
// `public` is answered as authored (36.11). Every other directory under the root is a segment of the
// address of the `page.abide`, `layout.abide` and `error.abide` in it (23.14).

/** A module under one only the server loads. */
export const SERVER_DIRECTORY = 'server'

/** A file under one is answered as authored, at the path above it. */
export const PUBLIC_DIRECTORY = 'public'

/** Both, as the walk of the app tests a directory against them. */
export const RESERVED_DIRECTORIES: ReadonlySet<string> = new Set([
    SERVER_DIRECTORY,
    PUBLIC_DIRECTORY,
])
