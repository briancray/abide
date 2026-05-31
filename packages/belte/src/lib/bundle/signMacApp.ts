import { log } from '../shared/log.ts'

/*
Ad-hoc code-signs an assembled macOS `.app` so it launches on other Macs.

Apple Silicon mandates a valid code signature for every executable. `bun
build --compile` emits an ad-hoc, linker-signed binary, but assembling the
`.app` around it (writing Info.plist, dropping in the lib) leaves the bundle
unsealed — `codesign --verify` then reports the signature as modified, and a
copy that picks up a quarantine flag (AirDrop, USB, download) gets silently
killed by Gatekeeper/AMFI: the icon bounces once and nothing opens.

Re-signing inside-out fixes that. Nested Mach-O code (the webview dylib, the
embedded server binary, the launcher) is signed first, then the bundle as a
whole, which seals Resources and binds Info.plist. The identity is `-`,
ad-hoc: no certificate, no Developer account, no network — as far as signing
goes without a paid Developer ID. Recipients copying a quarantined bundle
still need `xattr -cr <app>` once, but the app no longer fails to launch.

Best-effort: if `codesign` is missing or fails, warn and return rather than
abort the bundle, which is otherwise complete and usable on the build host.
*/
export async function signMacApp(bundleRoot: string, innerPaths: string[]): Promise<void> {
    try {
        // Inner Mach-O code inside-out, then the bundle, which re-signs the
        // main executable as part of sealing — order matters for nested seals.
        for (const path of innerPaths) {
            await Bun.$`codesign --force --sign - ${path}`.quiet()
        }
        await Bun.$`codesign --force --sign - ${bundleRoot}`.quiet()
    } catch (error) {
        log.warn(`could not code-sign ${bundleRoot} — it may not launch when copied to another Mac`)
        log.error(error)
    }
}
