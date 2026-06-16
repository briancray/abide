// @ts-expect-error virtual module resolved by abideResolverPlugin
import { banner, footer } from './_virtual/cli-chrome.ts'
// @ts-expect-error virtual module resolved by abideResolverPlugin
import manifest from './_virtual/cli-manifest.ts'
// @ts-expect-error virtual module resolved by abideResolverPlugin
import programName from './_virtual/cli-name.ts'
import { runCli } from './lib/cli/runCli.ts'

/*
Standalone CLI binary entry. Compiled with `bun build --compile` into
`dist/cli` (or `dist/cli-thin/<platform>/` for cross-builds). The CLI is
a thin remote client — no handler code is bundled; it talks to a running
server over HTTP (ABIDE_APP_URL at runtime). The bundler emits:
  - abide:cli-manifest — the per-rpc manifest (method, url, jsonSchema)
  - abide:cli-name     — the program name from package.json
  - abide:cli-chrome   — optional banner/footer text from src/cli/
*/
const exitCode = await runCli({
    programName,
    manifest,
    banner,
    footer,
    argv: process.argv.slice(2),
})
process.exit(exitCode)
