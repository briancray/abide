/*
A `.abide` component's virtual shadow is the same absolute path with `.ts`
appended (`Foo.abide` → `Foo.abide.ts`). The suffix lets a TypeScript host tell a
shadow apart from a real file and recover the source path. Shared by the one-shot
Program (`createShadowProgram`) and the incremental LanguageService (the LSP).
*/
export const shadowNaming = {
    suffixed: (abidePath: string): string => `${abidePath}.ts`,
    isShadow: (fileName: string): boolean => fileName.endsWith('.abide.ts'),
    sourceOf: (shadowName: string): string => shadowName.slice(0, -'.ts'.length),
}
