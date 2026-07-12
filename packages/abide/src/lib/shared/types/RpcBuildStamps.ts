import type { ErrorJsonSchemas } from './ErrorJsonSchemas.ts'
import type { InputCoercion } from './InputCoercion.ts'
import type { OutputWirePlan } from './OutputWirePlan.ts'

/*
The build-time facts the warm rpc server program resolves for one `$rpc/**` handler, gathered into
a single named payload that `prepareRpcModule` destructures (each rewrite direction picks the fields
it needs). Replaces a positional argument list where ordering was load-bearing — a new build stamp
is now one field on this shape rather than a new positional slot every caller must thread. Every
field is optional: an absent field means the warm program resolved no verdict (no program built, an
unresolvable node), and the rewrite falls open to its char-scan / today's behaviour exactly as
before. `streaming` overrides the char-scan streaming verdict; the rest are stamped as server opts
(`coercion`→`coerce`, `inputSchema`→`inputJsonSchema`, `outputSchema`→`outputJsonSchema`,
`errorSchemas`→`errorJsonSchemas`) or the client opt (`outputWirePlan`).

`clientKeep` is the reachability plan for the CLIENT rewrite: the source text of the top-level
statements the emitted client module must retain (imports + declarations transitively reachable from
the endpoint `opts`), computed through the binder/checker. Present → `rewriteForClient` emits a
MINIMAL module (`remoteProxy(opts)` plus only those statements), so the handler and every
declaration/import only it reaches is never emitted — nothing server-side is loaded, tree-shaken, or
flagged (superseding ADR-0022 D2/D3's "keep the file, trust DCE"). Absent (no warm program /
unresolvable rpc call) falls open to the keep-the-file char-scan rewrite.
*/
export type RpcBuildStamps = {
    streaming?: boolean
    coercion?: InputCoercion
    inputSchema?: Record<string, unknown>
    outputSchema?: Record<string, unknown>
    errorSchemas?: ErrorJsonSchemas
    outputWirePlan?: OutputWirePlan
    clientKeep?: string[]
}
