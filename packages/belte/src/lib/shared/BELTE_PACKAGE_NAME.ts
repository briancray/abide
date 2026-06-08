/*
The package's published npm name. The codegen and the import-name resolver
match a consuming project's dependency (direct or aliased) against this to
decide which specifier to emit, so keeping it in one place means a future
rename touches a single constant.
*/
export const BELTE_PACKAGE_NAME = '@briancray/belte'
