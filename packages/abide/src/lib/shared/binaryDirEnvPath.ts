import { dirname } from 'node:path'
import { bundleLayout } from './bundleLayout.ts'

/*
The bundle's shipped `.env` (its default config layer), resolved from the
running binary's directory via bundleLayout — beside the binary in the flat
layout, under `Contents/Resources` in a macOS `.app`. One statement of the
location for the boot loader, the config form, and the embedded-port resolver.
*/
export function binaryDirEnvPath(): string {
    return bundleLayout(dirname(process.execPath)).envPath
}
