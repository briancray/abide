/**
 * The prefix a server block's bindings are re-exported under (16.70): what the build's handler table
 * reads a private handler out of, and what a browser module loaded outside a bundle binds it from.
 */
export const PRIVATE_EXPORT = '__handler_'
