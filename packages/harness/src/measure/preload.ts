// Registers a DOM as globals for `bun test`, and installs the measure lane's patches
// beside it. Wired from the root bunfig.toml, so it runs once per test process and
// before any suite imports. Why the patches land once rather than per case: install.ts.
import { GlobalRegistrator } from '@happy-dom/global-registrator'

import { install } from './install.ts'
import { installPopover } from './installPopover.ts'

// A child spawned with this env would paint its output in ANSI off a pipe (bun's console, and
// abide's own log under RULEBOOK 36.9), and the suites compare that output as text. A terminal
// that exports it made the local gate red where CI, which never sets it, stayed green.
delete process.env.FORCE_COLOR

// THE WIRE STAYS BUN'S. happy-dom registers its own `fetch` family over bun's, and those drop a
// `cookie` or `origin` header a test sets, hand a handler a `Blob` with no `bytes()`, and are refused
// by `Bun.serve`; its `WebSocket` takes none of the upgrade headers bun's does, and its
// `TransformStream` and `WritableStream` are node's `Transform` and `Writable`, not web streams. The
// DOM reaches its own through its window either way.
const WIRE = [
    'fetch',
    'Request',
    'Response',
    'Headers',
    'Blob',
    'File',
    'FormData',
    'AbortController',
    'AbortSignal',
    'WebSocket',
    'TransformStream',
    'WritableStream',
] as const
const native: Record<string, unknown> = {}
for (const name of WIRE) native[name] = globalThis[name]
// 43.35 — a document a test parses names its stylesheets and scripts, and a DOM that fetched them
// would fetch them from a host nothing answers, in whichever test file happened to parse one.
// happy-dom fetches neither unless told to — a stylesheet needs `enableCSSFileLoading`, a script
// `enableJavaScriptEvaluation` — so what is set here is that a load it skipped fires `load`, as a
// fetched one would, rather than `error` and a logged `NotSupportedError`. 43.39 — an iframe's page
// it WOULD fetch, and does not.
GlobalRegistrator.register({
    url: 'http://localhost/',
    settings: {
        handleDisabledFileLoadingAsSuccess: true,
        disableIframePageLoading: true,
    },
})
const DomBlob = globalThis.Blob as unknown as abstract new (
    ...args: never[]
) => object
const DomFile = globalThis.File as unknown as typeof DomBlob
const DomFormData = globalThis.FormData as unknown as new (
    form?: unknown,
    submitter?: unknown,
) => Iterable<[string, unknown]>
for (const name of WIRE) Object.assign(globalThis, { [name]: native[name] })
bridgeFiles()
install()
installPopover()

/**
 * 43.37, 43.38 — ONE `File` FOR BOTH HALVES. The wire's are bun's (43.28), and happy-dom takes only
 * its own: `DataTransfer`, `FileReader` and `URL.createObjectURL` check `instanceof` against its
 * classes and then read the bytes off a symbol it keeps them under, and bun's `FormData` ignores
 * the form it is handed. So the globals become bun's classes, subclassed to keep a copy of the bytes
 * under happy-dom's symbol, and happy-dom's own `instanceof` is widened to a runtime `Blob` that
 * carries one. A `Blob` built from a part only the runtime can read (`Bun.file`) carries none, and
 * stays the wire's alone rather than reading as empty in the DOM.
 */
function bridgeFiles(): void {
    const RuntimeBlob = native.Blob as typeof Blob
    const RuntimeFile = native.File as typeof File
    const RuntimeFormData = native.FormData as typeof FormData
    const BYTES = Object.getOwnPropertySymbols(
        Reflect.construct(DomBlob, []),
    ).find((symbol) => symbol.description === 'buffer') as symbol
    const bytesOf = (parts: readonly unknown[]): Buffer | undefined => {
        const buffers: Buffer[] = []
        for (const part of parts) {
            if (part instanceof RuntimeBlob || part instanceof DomBlob) {
                const held = (part as Record<symbol, Buffer | undefined>)[BYTES]
                if (held === undefined) return undefined
                buffers.push(held)
            } else if (part instanceof ArrayBuffer)
                buffers.push(Buffer.from(new Uint8Array(part)))
            else if (ArrayBuffer.isView(part))
                buffers.push(
                    Buffer.from(
                        new Uint8Array(
                            part.buffer,
                            part.byteOffset,
                            part.byteLength,
                        ),
                    ),
                )
            else buffers.push(Buffer.from(String(part)))
        }
        return Buffer.concat(buffers)
    }
    // `instanceof` answers as the runtime's own does: a `File` bun's `formData()` parsed is not one of
    // these, and a check against the global must still take it.
    class BridgedBlob extends RuntimeBlob {
        static override [Symbol.hasInstance](candidate: unknown): boolean {
            return candidate instanceof RuntimeBlob
        }
        constructor(parts: BlobPart[] = [], options?: BlobPropertyBag) {
            const listed = [...parts]
            super(listed, options)
            ;(this as Record<symbol, unknown>)[BYTES] = bytesOf(listed)
        }
    }
    class BridgedFile extends RuntimeFile {
        static override [Symbol.hasInstance](candidate: unknown): boolean {
            return candidate instanceof RuntimeFile
        }
        constructor(
            parts: BlobPart[],
            name: string,
            options?: FilePropertyBag,
        ) {
            const listed = [...parts]
            super(listed, name, options)
            ;(this as Record<symbol, unknown>)[BYTES] = bytesOf(listed)
        }
    }
    // A form's entries come off happy-dom's own `FormData`, and the one it makes for an empty file
    // input is a happy-dom `File` the wire cannot send — so that one is copied into a bridged one.
    class BridgedFormData extends RuntimeFormData {
        static override [Symbol.hasInstance](candidate: unknown): boolean {
            return candidate instanceof RuntimeFormData
        }
        constructor(form?: HTMLFormElement, submitter?: HTMLElement | null) {
            super()
            if (form === undefined || form === null) return
            for (const [name, value] of new DomFormData(form, submitter)) {
                if (typeof value === 'string' || value instanceof RuntimeBlob)
                    this.append(name, value as string)
                else {
                    const file = value as File & Record<symbol, Buffer>
                    const bytes = file[BYTES] as Buffer
                    this.append(
                        name,
                        new BridgedFile([bytes as BlobPart], file.name, {
                            type: file.type,
                            lastModified: file.lastModified,
                        }),
                    )
                }
            }
        }
    }
    const ordinary = Function.prototype[Symbol.hasInstance]
    for (const [domClass, runtimeClass] of [
        [DomBlob, RuntimeBlob],
        [DomFile, RuntimeFile],
    ] as const)
        Object.defineProperty(domClass, Symbol.hasInstance, {
            value(this: unknown, candidate: unknown): boolean {
                return (
                    ordinary.call(this, candidate) ||
                    (candidate instanceof runtimeClass &&
                        (candidate as unknown as Record<symbol, unknown>)[
                            BYTES
                        ] !== undefined)
                )
            },
        })
    Object.assign(globalThis, {
        Blob: BridgedBlob,
        File: BridgedFile,
        FormData: BridgedFormData,
    })
}
