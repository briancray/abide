// The compiler — `.abide` source in, ESM modules out. Build time only, and resolvable by a build
// as `abide/compiler`.
//
// It is its own seam rather than a folder under #server, and the distinction survives being
// public: `abide/server` is what an app's REQUEST PATH imports, so a compiler reachable from it
// is one `export *` away from putting a bundler in an app's server graph. A separate entry is
// reached only by something already doing a build. Nothing here is in any client bundle, and
// `compiler.test.ts` holds the two apart by asserting what `abide/server` exports.

export { compileFile } from './compileFile.ts'
export { emitClient } from './emitClient.ts'
export { emitComponent } from './emitComponent.ts'
export { invokedComponents } from './invokedComponents.ts'
export { type AbideFile, parseAbide } from './parseAbide.ts'
export { planTemplate, type TemplatePlan } from './planTemplate.ts'
export type { Attribute, TemplateNode } from './TemplateNode.ts'
export { TypeSession } from './TypeSession.ts'
