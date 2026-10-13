// Where the build's own modules — the server's tables, the router's and the client entry — are served
// from, below the app's root (`abideModules`). Under the root so a bare specifier in them resolves as
// one in the app does, and under a `__abide` directory for the reason the addresses are: no app writes
// one.
export const VIRTUAL_DIRECTORY = '__abide'
