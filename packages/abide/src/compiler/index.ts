// The compiler seam — `.abide` source in, an ESM module out. Build time only.
//
// It is its own seam rather than a folder under #server because `abide/server` is a PUBLIC
// export: a compiler reachable from it is one `export *` away from being resolvable by an app,
// and from putting a bundler in an app's server graph. Nothing here is in any bundle.

export { compileFile } from './compileFile.ts'
export { emitComponent } from './emitComponent.ts'
export { type AbideFile, parseAbide } from './parseAbide.ts'
export type { Attribute, TemplateNode } from './TemplateNode.ts'
