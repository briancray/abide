import type { CompileTarget } from './types/CompileTarget.ts'

/*
Executable filename suffix for a compile target — `.exe` on Windows targets,
empty elsewhere. Single source so every cross-compile output path agrees.
*/
export function exeSuffix(target: CompileTarget): string {
    return target.includes('windows') ? '.exe' : ''
}
