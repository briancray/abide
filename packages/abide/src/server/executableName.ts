import { UNNAMED } from '#shared/UNNAMED.ts'

// 38.46 — A SCOPED NAME IS NAMED BY ITS LAST PART: `@acme/ledger` is `ledger`, as `bunx` calls it.
export function executableName(packageName: string | undefined): string {
    return (packageName ?? UNNAMED).replace(/^@[^/]+\//, '')
}
