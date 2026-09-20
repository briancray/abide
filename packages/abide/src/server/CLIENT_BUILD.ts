// WHERE THE BROWSER BUNDLE IS, named once for the two commands that have to agree about it:
// `abide build` writes it and `abide start` answers it. A leaf, with no imports of its own, for
// the reason every constant crossing a seam is one — the build is in `bin/` and the server is in
// `src/server/`, and a string spelled out in both is a build that silently serves nothing.
//
// UNDER `/__abide`, which is the namespace the framework's own addresses already live in (19.1,
// 20.5, 25.1). That is what makes a route table and an asset table incapable of colliding: a page
// is a directory under `pages/` and no directory there can be named `__abide` without an author
// writing it, so nothing has to be checked at build time and nothing can be shadowed at run time.
// 38.21 is the clause.
export const CLIENT_ADDRESS = '/__abide/client'

// The directory the bundle lands in, below the build's own output directory.
export const CLIENT_DIRECTORY = 'client'

// The module that mounts the app, and so the one file in the bundle whose name the shell writes
// out. Everything else a page needs is reached from here and named by the bundler.
//
// THE STYLESHEET IS THE SAME NAME. A `.abide` that imports a stylesheet (34.5) makes it a
// dependency of the client module, and the bundler collects every one it reaches under an entry
// into `<entry>.css` — so the extension is the whole difference and there is no second constant.
export const CLIENT_ENTRY = 'entry'

// 38.19 — where `abide build` copies `src/ui/public`, below its own output directory. A directory
// rather than the source tree: `abide start` boots what the build produced and reaches for nothing
// an app might have moved since.
export const PUBLIC_DIRECTORY = 'public'
