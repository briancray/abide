/*
The bare leaf filename of a path — directory stripped, extension kept —
e.g. `users/list.ts` → `list.ts`. The extension-stripping `fileStem` builds on
this; call sites that match a full filename (`layout.abide`, `page.abide`) use
it directly so the leaf-grab is written one way.
*/
export function fileName(path: string): string {
    return path.split('/').pop() ?? ''
}
