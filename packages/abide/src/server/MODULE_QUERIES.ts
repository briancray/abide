// WHAT AN IMPORT OF A `.abide` ASKS FOR, spelled on the specifier: bun hands a plugin no import
// attributes, so the compiler writes the face it wants where the plugin can read it
// (`abideModules`). A `.abide` named with none is the face a module abide did not compile gets.

/** The module the file compiles to, as a compiled module imports it. 32.17. */
export const COMPONENT_QUERY = '?component'

/** The file's scoped stylesheet, which its browser module imports. 34.4. */
export const STYLE_QUERY = '?style'

/** The file's text. 34.25. */
export const TEXT_QUERY = '?text'

/**
 * The file's browser module, asked for outside a browser bundle — a component's hydration tested
 * under a DOM in `bun test`. Its own `.abide` imports are browser modules too.
 */
export const CLIENT_QUERY = '?client'
