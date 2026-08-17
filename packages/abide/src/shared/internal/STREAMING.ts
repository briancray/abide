// The decode options every streaming read passes on every chunk.
//
// Its own file, and the reason is entirely about which CHUNK its importers land in. Four readers want
// it — `wire.ts`'s NDJSON line reader, `#ui`'s navigation piece reader, and the CLI's `logs` and
// `repl` — so one declaration is right, and it used to live in `wire.ts` beside the first of them.
//
// That one import cost the browser 3,002 minified bytes. A module reached from the first-load closure
// keeps every export ANYTHING in the build uses, so `navigation.ts` naming a two-word constant put
// `wire.ts` in the chunk every page loads, and with it `encodeArgs`, `argsQuery`, `multipartBody` and
// the rest of the rpc argument encoder — on pages that call no rpc. A leaf with no imports of its own
// cannot do that to anybody.
//
// So the file is not a home for options in general: anything added here has to be something all of
// those readers want, or it is `wire.ts` again with a different name.

export const STREAMING: TextDecodeOptions = { stream: true }
