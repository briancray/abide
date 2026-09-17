// The compiler seam — `.abide` source in, ESM modules out. Build time only.
//
// It is its own seam rather than a folder under #server because `abide/server` is a PUBLIC
// export: a compiler reachable from it is one `export *` away from being resolvable by an app,
// and from putting a bundler in an app's server graph. Nothing here is in any bundle.

export { compileFile } from './compileFile.ts'
export { emitClient } from './emitClient.ts'
export { emitComponent } from './emitComponent.ts'
export { type AbideFile, parseAbide } from './parseAbide.ts'
export { planTemplate, type TemplatePlan } from './planTemplate.ts'
export type { Attribute, TemplateNode } from './TemplateNode.ts'
