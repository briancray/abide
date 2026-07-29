// THE LANGUAGE FEATURES THIS SERVER IMPLEMENTS — each method paired with the capability that
// advertises it, so the two cannot be added apart.
//
// They were two lists: a `capabilities` object literal in the `initialize` reply, and a `switch` over
// method names 60-170 lines below it, related by convention only. Both failure modes are SILENT and
// they fail in opposite directions:
//
//   • a handler with no capability → the editor never sends the request, so the feature is dead code
//     and every test still passes;
//   • a capability with no handler → the editor sends the request and gets no reply, and an LSP client
//     with no timeout simply hangs.
//
// `lsp.test.ts` touched `capabilities` once, to check `textDocumentSync.change`, and asserted nothing
// about the other six. This is the same shape `RESERVED_CLI_COMMANDS` solved for the compiled binary's
// command surface — one table, everything else derived from it.
//
// `textDocumentSync` is deliberately NOT here: it advertises the document LIFECYCLE
// (didOpen/didChange/didSave/didClose), which is four notifications answering nothing, not a
// request/response feature with one handler apiece.
export const LSP_FEATURES = {
    'textDocument/hover': { capability: 'hoverProvider', advertise: true },
    'textDocument/definition': { capability: 'definitionProvider', advertise: true },
    'textDocument/completion': {
        capability: 'completionProvider',
        advertise: { triggerCharacters: ['.'] },
    },
    'textDocument/signatureHelp': {
        capability: 'signatureHelpProvider',
        advertise: { triggerCharacters: ['(', ','] },
    },
    'textDocument/references': { capability: 'referencesProvider', advertise: true },
    'textDocument/semanticTokens/full': { capability: 'semanticTokensProvider', advertise: null },
} as const

export type LspFeatureMethod = keyof typeof LSP_FEATURES

// The `capabilities` half of an `initialize` reply, built from the table. `semanticTokensProvider`
// carries the token legend, which is a value this module has no business importing, so its `advertise`
// is `null` and the caller supplies it.
export function lspCapabilities(overrides: Record<string, unknown>): Record<string, unknown> {
    const capabilities: Record<string, unknown> = {
        // The document lifecycle, not a feature — see above.
        textDocumentSync: { openClose: true, change: 1, save: true },
    }
    for (const feature of Object.values(LSP_FEATURES)) {
        capabilities[feature.capability] =
            feature.advertise === null ? (overrides[feature.capability] ?? true) : feature.advertise
    }
    return capabilities
}
