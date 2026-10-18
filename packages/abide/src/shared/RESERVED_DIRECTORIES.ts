// THE FENCES: the two directory names that are never an address (23.15). `public` is answered as
// authored (36.11), and `lib` holds what is neither an address nor that. Every other directory under
// the root is a segment of the routes of the files directly in it (23.14), and holds nothing else
// (23.22). What only the server loads is a file's NAME rather than a directory's (16.29), and so is a
// test — `placement.ts` reads both.

/** A file under one is answered as authored, at the path above it. */
export const PUBLIC_DIRECTORY = 'public'

/** The app's own code that is no address: components and modules, both sides. */
export const LIB_DIRECTORY = 'lib'

/** Both, as the walk of the app tests a directory against them. */
export const RESERVED_DIRECTORIES: ReadonlySet<string> = new Set([
    PUBLIC_DIRECTORY,
    LIB_DIRECTORY,
])
