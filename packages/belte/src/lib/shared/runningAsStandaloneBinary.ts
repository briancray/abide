/*
True when this code runs inside a `bun build --compile` standalone executable
(the bundle's embedded server, or an install-tarball server binary) rather than
under the `bun` CLI. Bun mounts a compiled binary's embedded modules under a
synthetic root — `/$bunfs/…` on posix, `…~BUN…` on Windows — so `Bun.main`
carries that marker only in a standalone binary; under `bun dev`/`bun start`
it's a real on-disk path. Used to scope the bundle's data-dir/binary-dir `.env`
loading to the shipped app, so `bun dev`/`bun start` keep to their project-local
CWD `.env` alone.
*/
export function runningAsStandaloneBinary(): boolean {
    return Bun.main.includes('$bunfs') || Bun.main.includes('~BUN')
}
