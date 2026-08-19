// Where the things this grammar cannot look inside END.
//
// Four tokens, and they are all the same question asked at different stops: a `<script>` body ends at
// its own closing tag, and a run of TypeScript ends at a `}` that nothing opened. Neither is a regular
// language, which is the whole reason this file exists — a tree-sitter regex has no counter and no
// lookahead, so `{ a: { b: 1 } }` would end at the first `}` and take the rest of the template with it.
//
// This is the editor's half of `readExpression`, which the compiler answers with TypeScript's own
// scanner. It cannot borrow that, so it approximates it: brace depth, the three string forms with
// `${}` nesting inside a template literal, and both comment forms. The one case it knowingly gets
// wrong is a REGEX LITERAL holding an unbalanced brace or quote — `/}/` — because telling a regex from
// a division needs the token before it, which is exactly the state a lexer this size does not keep.
// The cost is bounded and local: one expression highlights as far as the brace, and the compiler still
// reports the truth about it.

#include "tree_sitter/parser.h"

#include <string.h>
#include <wctype.h>

enum TokenType {
    RAW_TEXT,
    EXPRESSION_TEXT,
    LIST_TEXT,
    BINDING_TEXT,
    ERROR_SENTINEL,
};

void *tree_sitter_abide_external_scanner_create(void) { return NULL; }
void tree_sitter_abide_external_scanner_destroy(void *payload) { (void)payload; }
unsigned tree_sitter_abide_external_scanner_serialize(void *payload, char *buffer) {
    (void)payload;
    (void)buffer;
    return 0;
}
void tree_sitter_abide_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
    (void)payload;
    (void)buffer;
    (void)length;
}

/** A `<script>` or `<style>` body: everything up to the closing tag that ends it. */
static bool scan_raw_text(TSLexer *lexer) {
    lexer->result_symbol = RAW_TEXT;
    bool any = false;
    for (;;) {
        if (lexer->eof(lexer)) {
            lexer->mark_end(lexer);
            return any;
        }
        if (lexer->lookahead == '<') {
            // Marked BEFORE the `<` is consumed, so a closing tag found below is left for the
            // grammar to lex rather than swallowed into the body.
            lexer->mark_end(lexer);
            lexer->advance(lexer, false);
            if (lexer->lookahead == '/') {
                lexer->advance(lexer, false);
                char word[7];
                unsigned length = 0;
                while (length < 6 && iswalpha(lexer->lookahead)) {
                    word[length++] = (char)towlower(lexer->lookahead);
                    lexer->advance(lexer, false);
                }
                word[length] = '\0';
                // The same two closers `RAW_CLOSE` names, and case-insensitive for the same reason.
                if (strcmp(word, "script") == 0 || strcmp(word, "style") == 0) return any;
            }
            any = true;
            continue;
        }
        lexer->advance(lexer, false);
        any = true;
    }
}

/** A string literal, consumed whole. `quote` has already been read. */
static void scan_string(TSLexer *lexer, int32_t quote) {
    while (!lexer->eof(lexer)) {
        if (lexer->lookahead == '\\') {
            lexer->advance(lexer, false);
            if (lexer->eof(lexer)) return;
            lexer->advance(lexer, false);
            continue;
        }
        if (lexer->lookahead == quote) {
            lexer->advance(lexer, false);
            return;
        }
        // An unterminated `'` would otherwise eat the rest of the file. A newline ends it, which is
        // what the language says too for the two quote forms.
        if (quote != '`' && lexer->lookahead == '\n') return;
        lexer->advance(lexer, false);
    }
}

/**
 * A template literal, consumed whole — including the `${…}` holes, whose braces must not be counted
 * against the enclosing expression. `` ` `` has already been read.
 */
static void scan_template(TSLexer *lexer) {
    while (!lexer->eof(lexer)) {
        if (lexer->lookahead == '\\') {
            lexer->advance(lexer, false);
            if (lexer->eof(lexer)) return;
            lexer->advance(lexer, false);
            continue;
        }
        if (lexer->lookahead == '`') {
            lexer->advance(lexer, false);
            return;
        }
        if (lexer->lookahead == '$') {
            lexer->advance(lexer, false);
            if (lexer->lookahead != '{') continue;
            lexer->advance(lexer, false);
            unsigned depth = 1;
            while (!lexer->eof(lexer) && depth > 0) {
                if (lexer->lookahead == '{') depth++;
                else if (lexer->lookahead == '}') depth--;
                else if (lexer->lookahead == '\'' || lexer->lookahead == '"') {
                    int32_t quote = lexer->lookahead;
                    lexer->advance(lexer, false);
                    scan_string(lexer, quote);
                    continue;
                } else if (lexer->lookahead == '`') {
                    lexer->advance(lexer, false);
                    scan_template(lexer);
                    continue;
                }
                lexer->advance(lexer, false);
            }
            continue;
        }
        lexer->advance(lexer, false);
    }
}

/** A line comment to the line's end, or a block comment to its closer. The `/` has already been read. */
static bool scan_comment(TSLexer *lexer) {
    if (lexer->lookahead == '/') {
        while (!lexer->eof(lexer) && lexer->lookahead != '\n') lexer->advance(lexer, false);
        return true;
    }
    if (lexer->lookahead != '*') return false;
    lexer->advance(lexer, false);
    for (;;) {
        if (lexer->eof(lexer)) return true;
        if (lexer->lookahead == '*') {
            lexer->advance(lexer, false);
            if (lexer->lookahead == '/') {
                lexer->advance(lexer, false);
                return true;
            }
            continue;
        }
        lexer->advance(lexer, false);
    }
}

/**
 * TypeScript up to the `}` that closes the hole — or, when `stop_word` is given, up to that word
 * written at depth zero.
 *
 * `stop_word` is what separates the three expression tokens: `of` ends a `{#for}`'s bindings, `by`
 * ends its list, and an ordinary hole has none. A word only stops the scan on a whitespace boundary
 * at depth zero, so `sortedBy` and `typeof` are not the words they end with — the same distinction
 * `BY_KEYWORD` draws with `(^|[^\w$])by(?=\s)` and for the same reason.
 *
 * `mark_end` is called only after a NON-space character, so the token never carries the whitespace
 * before the `}`. That matters beyond tidiness: the text is handed to the TypeScript grammar as an
 * injection, and a range that starts on whitespace shifts every highlight inside it.
 */
static bool scan_code(TSLexer *lexer, enum TokenType symbol, const char *stop_word) {
    lexer->result_symbol = symbol;

    // Skipped rather than consumed, so the token STARTS on code.
    while (!lexer->eof(lexer) && iswspace(lexer->lookahead)) lexer->advance(lexer, true);

    unsigned depth = 0;
    bool any = false;
    bool after_space = true;

    for (;;) {
        if (lexer->eof(lexer)) return false;

        int32_t c = lexer->lookahead;

        if (depth == 0 && c == '}') return any;

        if (stop_word != NULL && depth == 0 && after_space && c == (int32_t)stop_word[0]) {
            // Marked before the word is read: if it IS the stop word the token ends where the code
            // did, and if it is not, the characters are ordinary content that `any` already covers.
            lexer->advance(lexer, false);
            if (lexer->lookahead == (int32_t)stop_word[1]) {
                lexer->advance(lexer, false);
                if (iswspace(lexer->lookahead) || lexer->lookahead == '}') return any;
                lexer->mark_end(lexer);
                any = true;
                after_space = false;
                continue;
            }
            lexer->mark_end(lexer);
            any = true;
            after_space = false;
            continue;
        }

        if (iswspace(c)) {
            lexer->advance(lexer, false);
            after_space = true;
            continue;
        }

        after_space = false;

        if (c == '\'' || c == '"') {
            lexer->advance(lexer, false);
            scan_string(lexer, c);
        } else if (c == '`') {
            lexer->advance(lexer, false);
            scan_template(lexer);
        } else if (c == '/') {
            lexer->advance(lexer, false);
            scan_comment(lexer);
        } else {
            if (c == '{') depth++;
            else if (c == '}') depth--;
            lexer->advance(lexer, false);
        }

        lexer->mark_end(lexer);
        any = true;
    }
}

bool tree_sitter_abide_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
    (void)payload;

    // Recovery marks every external valid at once, which is not a question any of them can answer:
    // asked for a `<script>` body where there is none, `scan_raw_text` consumes to the next closing
    // tag or to the end of the file. Declining leaves the recovery to the parser, which is the one
    // that knows what it was looking for.
    if (valid_symbols[ERROR_SENTINEL]) return false;

    if (valid_symbols[RAW_TEXT]) return scan_raw_text(lexer);
    if (valid_symbols[BINDING_TEXT]) return scan_code(lexer, BINDING_TEXT, "of");
    if (valid_symbols[LIST_TEXT]) return scan_code(lexer, LIST_TEXT, "by");
    if (valid_symbols[EXPRESSION_TEXT]) return scan_code(lexer, EXPRESSION_TEXT, NULL);
    return false;
}
