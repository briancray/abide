#!/usr/bin/env bun
/*
Post-`changeset version` mirror. Changesets writes the changelog inside the
published package (packages/belte/CHANGELOG.md); this copies it to the repo root
so the release history is visible at the top level too. Single published package,
so a verbatim copy is the whole story. Runs inside `version-packages`, so both
local and CI versioning keep the root copy in step with the package's.
*/
import { $ } from 'bun'

const PACKAGE_CHANGELOG = 'packages/belte/CHANGELOG.md'
const ROOT_CHANGELOG = 'CHANGELOG.md'

const source = Bun.file(PACKAGE_CHANGELOG)
if (!(await source.exists())) {
    // Nothing released yet — the package changelog appears on the first version bump.
    process.exit(0)
}

await Bun.write(ROOT_CHANGELOG, await source.text())
// Stage it so the Version Packages commit carries the root copy alongside the package's.
await $`git add ${ROOT_CHANGELOG}`
console.log(`synced ${ROOT_CHANGELOG} from ${PACKAGE_CHANGELOG}`)
