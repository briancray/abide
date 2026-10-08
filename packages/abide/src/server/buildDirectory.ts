import { dirname } from 'node:path' // bun exposes no path helpers of its own

/**
 * Where an app's build goes: `.abide` in the directory above its source root.
 *
 * BESIDE THE APP RATHER THAN BESIDE THE SHELL: an app's build belongs to the app.
 */
export function buildDirectory(root: string): string {
    return `${dirname(root)}/.abide`
}
