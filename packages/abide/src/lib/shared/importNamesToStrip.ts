import { ABIDE_PACKAGE_NAME } from './ABIDE_PACKAGE_NAME.ts'

/*
The names a user may import a abide server helper under: the project's chosen
alias plus the canonical package name. The resolver strips the dead import
under both so it can't side-effect-load the server stub into the client
bundle. When the alias already is the canonical name, there's only one.
*/
export function importNamesToStrip(importName: string): string[] {
    return importName === ABIDE_PACKAGE_NAME
        ? [ABIDE_PACKAGE_NAME]
        : [importName, ABIDE_PACKAGE_NAME]
}
