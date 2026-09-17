// What EMITTED code resolves the server runtime through. It is a leaf because it is the contract
// between the compiler and an app's module graph: emitted code is the app's, so it reaches for the
// public specifier that `packages/abide` itself is forbidden to.
export const SERVER_SPECIFIER = 'abide/server'
