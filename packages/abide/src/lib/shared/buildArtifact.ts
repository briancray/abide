import type { BuildConfig, BuildOutput } from 'bun'
import { exitOnBuildFailure } from './exitOnBuildFailure.ts'

/*
Runs one Bun.build and fails the process on any diagnostic, returning the
successful output — the build-or-die pairing every one-shot build site shares
(compile, buildCli's discovery + cli, bundleApp, buildDisconnected). Keeps the
`Bun.build` + `exitOnBuildFailure` step atomic so a new build site can't ship
without the failure check. The incremental client build (build.ts) does NOT use
this: it must clean its staging dir and return `false` rather than exit, so it
keeps its own epilogue.
*/
export async function buildArtifact(config: BuildConfig): Promise<BuildOutput> {
    /* metafile: true so the abideResolverPlugin's onEnd reachability guard (ADR-0022 D3) can read
       the post-DCE graph on a client build (buildDisconnected). Harmless extra output on the
       server builds that also route through here. A caller can still override it explicitly. */
    const result = await Bun.build({ metafile: true, ...config })
    exitOnBuildFailure(result)
    return result
}
