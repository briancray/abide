// @ts-expect-error virtual module resolved by belteResolverPlugin
import { banner, footer } from './_virtual/cli-chrome.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import manifest from './_virtual/cli-manifest.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin
import programName from './_virtual/cli-name.ts'
// @ts-expect-error virtual module resolved by belteResolverPlugin — side-effect import that
// populates verbRegistry for in-process mode on full builds; empty on thin builds
import './_virtual/cli-rpcs.ts'
import { runCli } from './lib/cli/runCli.ts'

/*
Standalone CLI binary entry. Compiled with `bun build --compile` into
`dist/cli` (full, default) or `dist/cli-thin` (with `--thin`). The
bundler emits:
  - belte:cli-manifest — the per-rpc manifest (method, url, jsonSchema)
  - belte:cli-name     — the program name from package.json
  - belte:cli-chrome   — optional banner/footer text from src/cli/

All are virtual modules so the same source file works for thin and
full builds; what differs is whether the verbRegistry is also bundled
in (full mode → in-process fallback; thin mode → APP_URL required).
*/
const exitCode = await runCli({
    programName,
    manifest,
    banner,
    footer,
    argv: process.argv.slice(2),
})
process.exit(exitCode)
