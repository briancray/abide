/**
 * An answer as the Messages API streams it: a run of plain words, then a cited run — a page of the
 * statement it was handed, `CITATION` written out, as a leaf imports nothing — with a usage that read
 * most of the prompt from the cache. What `fakeCitingApi` and the fake Claude Code's `cite` case
 * stream, event for event.
 */
export const CITED_EVENTS = [
    {
        type: 'message_start',
        message: {
            id: 'msg_cited',
            type: 'message',
            role: 'assistant',
            model: 'claude-opus-5-5',
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: {
                input_tokens: 4,
                output_tokens: 1,
                cache_creation_input_tokens: 2,
                cache_read_input_tokens: 7,
            },
        },
    },
    {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
    },
    {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Your balance ' },
    },
    { type: 'content_block_stop', index: 0 },
    {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'text', text: '', citations: [] },
    },
    {
        type: 'content_block_delta',
        index: 1,
        delta: {
            type: 'citations_delta',
            citation: {
                type: 'page_location',
                cited_text: 'BALANCE 4217',
                document_index: 0,
                document_title: 'statement.pdf',
                start_page_number: 1,
                end_page_number: 2,
            },
        },
    },
    {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'text_delta', text: 'is 4217' },
    },
    {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'text_delta', text: '.' },
    },
    { type: 'content_block_stop', index: 1 },
    {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 6 },
    },
    { type: 'message_stop' },
]
