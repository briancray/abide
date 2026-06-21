import type { ReactiveNode } from './types/ReactiveNode.ts'

/*
Shared state for scope-bound RPC abort. `controllers` maps a reactive computation
(effect/computed) to the AbortController of the RPC(s) it fired, kept OFF
ReactiveNode — like an effect's cleanup closure — so signals and the read/write hot
path pay nothing. `armed` flips true the first time an RPC binds a controller and
gates the runNode/unlinkDeps lookups, so an app that never fires a reactive RPC pays
only one boolean check per compute run. Mirrors REACTIVE_CONTEXT's single-object
pattern (shared mutable singletons on one object, reached without a barrel).
*/
export const reactiveAbortState: {
    controllers: WeakMap<ReactiveNode, AbortController>
    armed: boolean
} = { controllers: new WeakMap(), armed: false }
