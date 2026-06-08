import { BELTE_PACKAGE_NAME } from './BELTE_PACKAGE_NAME.ts'
import { readPackageJson } from './readPackageJson.ts'

/*
Resolves the bare specifier prefix a consuming project imports belte under —
the name belte is installed as in its package.json. A project may depend on
belte directly (`@briancray/belte`) or behind a package alias
(`"belte": "npm:@briancray/belte@..."`, or `workspace:@briancray/belte@*`
inside this repo). An alias-only install resolves only under the alias key and
a direct install only under the canonical name, so the generated rpc / socket
/ prompt modules must import under whichever name the project
declared.

Prefers a `belte` alias (the ergonomic surface the docs use) when present, then
a direct canonical dependency, then any other alias targeting belte. Falls back
to the canonical name when belte isn't found in package.json — the build can't
resolve belte at all in that case, and the canonical name yields the clearest
resolution error.
*/
export async function belteImportName(cwd: string): Promise<string> {
    const packageJson = (await readPackageJson(cwd)) as
        | { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
        | undefined
    if (!packageJson) {
        return BELTE_PACKAGE_NAME
    }
    const dependencies = { ...packageJson.devDependencies, ...packageJson.dependencies }
    /*
    Alias entries whose target is belte — `npm:` for a published install,
    `workspace:` for the in-repo examples. The key is the name the project
    imports under; the version suffix (`@^0.2.0`, `@*`) is optional.
    */
    const aliasPattern = new RegExp(`^(npm|workspace):${BELTE_PACKAGE_NAME}(@.*)?$`)
    const aliasNames = Object.entries(dependencies)
        .filter(([, specifier]) => aliasPattern.test(specifier))
        .map(([name]) => name)
    if (aliasNames.includes('belte')) {
        return 'belte'
    }
    if (BELTE_PACKAGE_NAME in dependencies) {
        return BELTE_PACKAGE_NAME
    }
    return aliasNames[0] ?? BELTE_PACKAGE_NAME
}
