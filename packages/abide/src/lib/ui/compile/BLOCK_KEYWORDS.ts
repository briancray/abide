/*
The control-block vocabulary — the ONE source of truth shared by the parser
(`parseTemplate`'s dispatch/error) and the LSP highlighter (`structuralBlockTokens`), so
the keywords the highlighter colors can't drift from the blocks the parser accepts (the
`{#snippet}` head once went uncolored because the highlighter's hand-copy omitted it).

`BLOCK_OPENERS` follow `{#`, `BLOCK_CONNECTORS` follow `{:`. `for await` is the async-each
opener form the highlighter colors as one phrase (the parser reads the `await` inside a
`for` head); it is not a distinct opener.
*/
export const BLOCK_OPENERS = ['if', 'for', 'await', 'switch', 'try', 'snippet'] as const

export const BLOCK_CONNECTORS = [
    'else if',
    'else',
    'then',
    'catch',
    'finally',
    'case',
    'default',
] as const
