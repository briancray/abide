import { resolveTemplateAlias } from './resolveTemplateAlias.ts'

// Where a `<script>`'s ordinary import actually points. Both runtime emitters write their compiled
// module somewhere OTHER than next to the `.abide` — the client bundle into a tmpdir, SSR into abide's
// own internal dir — so a specifier that was correct where it was written resolves against the wrong
// base once it lands. Every pass-through import is therefore rewritten to an absolute path first.
//
// Three shapes reach here and all three are ordinary: a tsconfig alias (`$ui/…`, `$shared/…`), a
// relative path (`./util.ts`), and a bare package (`@scope/pkg`, `abide/shared/online`). The app's own
// dir resolves the first two and its dependencies; abide's dir is the fallback that resolves `abide/*`
// for an app that does not depend on abide directly (its own test harness, chiefly).
const ABIDE_DIR = import.meta.dir

export function resolvePassThroughImport(specifier: string, sourceDir: string | undefined): string {
    const alias = sourceDir === undefined ? undefined : resolveTemplateAlias(specifier, sourceDir)
    const candidates = alias === undefined ? [specifier] : [alias, specifier]
    const bases = sourceDir === undefined ? [ABIDE_DIR] : [sourceDir, ABIDE_DIR]
    for (const candidate of candidates) {
        for (const base of bases) {
            try {
                return Bun.resolveSync(candidate, base)
            } catch {
                // try the next base — a bare specifier misses from the app dir when it is abide's own
            }
        }
    }
    // LOUD, not a silent `undefined` at mount. Before ordinary imports passed through, an unrecognised
    // specifier fell back to a `$scope` read and the binding simply arrived undefined in the browser —
    // clean build, `TypeError` at first use, nothing pointing at the import. Same contract the socket
    // reachability check already keeps (`clientBundle.ts`): fail at build time, name the specifier.
    throw new Error(
        `abide: a <script> imports "${specifier}" but it could not be resolved${
            sourceDir === undefined ? '' : ` from ${sourceDir}`
        }. Check the path, the package name, or the tsconfig alias.`,
    )
}
