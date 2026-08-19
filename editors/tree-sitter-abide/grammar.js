/// <reference types="tree-sitter-cli/dsl" />

// The `.abide` grammar, for an editor rather than for the compiler.
//
// `packages/abide/compiler/internal/parse.ts` is the authority on what this language IS, and this
// file is a SECOND reader of the same text with a different job: the compiler must be exactly right
// about a file that compiles, and this must be approximately right about one somebody is halfway
// through typing. So the two disagree on purpose in one direction only — everything here is more
// permissive, never less, because a grammar that refuses a half-written block takes the highlighting
// off the rest of the file with it.
//
// Three decisions are taken FROM the compiler rather than invented here, and each is the one place
// the two could drift:
//
//   * A tag is a COMPONENT when it starts with a capital — `parseTag`'s `/^[A-Z]/`. So `tag_name` is
//     lowercase-initial and `component_name` is uppercase-initial, and the two token classes cannot
//     overlap. That is why there is no ambiguity to resolve and no `conflicts` block below.
//   * The void elements are `VOID_ELEMENTS.ts`'s list, spelled as literal tokens so `<img>` cannot
//     wait for a `</img>` that the compiler would never expect either.
//   * The blocks and their branches are `BRANCHES` — `if`/`for`/`switch`/`try`/`component`. A sixth
//     block is a rule here as well as a row there, which is the drift this comment cannot prevent
//     and `test/corpus/blocks.txt` is what catches.
//
// Everything between braces is TypeScript and is never interpreted: `expression_text` is one opaque
// token that the external scanner finds the end of, and `injections.scm` hands it to the TypeScript
// grammar. That is the same split `parse.ts` makes with `readExpression`, for the same reason — a
// template expression is the language itself rather than a dialect of it.

const VOID_ELEMENTS = [
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr',
]

module.exports = grammar({
    name: 'abide',

    // The scanner finds the END of things this grammar deliberately cannot look inside: a raw
    // `<script>` body, and a run of TypeScript whose closing `}` is decided by nesting, strings,
    // template holes and comments rather than by the first `}` in the text.
    //
    // `_error_sentinel` is never written in a rule, which is exactly what makes it useful: tree-sitter
    // marks every external token valid while it is RECOVERING, so without it a half-typed file asks
    // the scanner for a `<script>` body at a position that has none and it eats the rest of the
    // buffer. An editor holds a broken file most of the time, so that is the common case rather than
    // the odd one.
    externals: ($) => [$.raw_text, $.expression_text, $.list_text, $.binding_text, $._error_sentinel],

    // Whitespace only. A `.abide` comment is `<!-- -->`, which is markup the compiler carries
    // through into the document, so it is a NODE here rather than an extra.
    extras: () => [/\s+/],

    rules: {
        document: ($) => repeat($._node),

        _node: ($) =>
            choice(
                $.comment,
                $.script_element,
                $.style_element,
                $.if_block,
                $.for_block,
                $.switch_block,
                $.try_block,
                $.component_block,
                $.element,
                $.void_element,
                $.self_closing_element,
                $.component,
                $.self_closing_component,
                $.expression,
                $.text,
            ),

        comment: () => token(seq('<!--', /[^-]*-+([^->][^-]*-+)*/, '>')),

        // --- raw blocks ----------------------------------------------------
        //
        // `<script>`, `<script module>` and `<style>`. The body is one token the template parser
        // never looks inside — `findRawBlock` lifts exactly these before parsing for the same
        // reason, so a `<` in a generic is not an open tag and a `{` in an object literal is not a
        // hole.

        script_element: ($) => seq($.script_start_tag, optional($.raw_text), $.script_end_tag),
        script_start_tag: ($) => seq('<', alias('script', $.tag_name), repeat($._attribute), '>'),
        script_end_tag: ($) => seq('</', alias('script', $.tag_name), '>'),

        style_element: ($) => seq($.style_start_tag, optional($.raw_text), $.style_end_tag),
        style_start_tag: ($) => seq('<', alias('style', $.tag_name), repeat($._attribute), '>'),
        style_end_tag: ($) => seq('</', alias('style', $.tag_name), '>'),

        // --- elements ------------------------------------------------------

        element: ($) => seq($.start_tag, repeat($._node), $.end_tag),
        start_tag: ($) => seq('<', $.tag_name, repeat($._attribute), '>'),
        end_tag: ($) => seq('</', $.tag_name, '>'),
        self_closing_element: ($) => seq('<', $.tag_name, repeat($._attribute), '/>'),

        // Spelled out so the parser does not wait for a closing tag the compiler never writes.
        void_element: ($) =>
            seq('<', alias($._void_tag_name, $.tag_name), repeat($._attribute), optional('/'), '>'),
        _void_tag_name: () => choice(...VOID_ELEMENTS),

        component: ($) => seq($.component_start_tag, repeat($._node), $.component_end_tag),
        component_start_tag: ($) => seq('<', $.component_name, repeat($._attribute), '>'),
        component_end_tag: ($) => seq('</', $.component_name, '>'),
        self_closing_component: ($) => seq('<', $.component_name, repeat($._attribute), '/>'),

        // Lowercase-initial and uppercase-initial: the compiler's own test for a component, which is
        // what keeps these two token classes from overlapping. `<slot>` is an ordinary element here
        // and is picked out by name in `highlights.scm`.
        tag_name: () => /[a-z][\w:.-]*/,
        component_name: () => /[A-Z][\w:.$-]*/,

        // --- attributes ----------------------------------------------------
        //
        // ONE shape, matching `ATTRIBUTE_NAME_CHAR`. `bind:`, `class:`, `style:` and `on…` are not
        // rules of their own: `classify()` tells them apart by their spelling, so a query with the
        // same prefix test tells them apart too, and the grammar keeps no second opinion about which
        // prefixes are special.

        _attribute: ($) => choice($.attribute, $.spread_attribute),

        attribute: ($) =>
            seq(
                $.attribute_name,
                optional(seq('=', choice($.quoted_attribute_value, $.attribute_value, $.expression))),
            ),

        attribute_name: () => /[\w:@.$-]+/,
        attribute_value: () => /[^\s"'=<>`{}]+/,

        // `class="a {b} c"` — literal and holes mixed, which the compiler owns whole.
        quoted_attribute_value: ($) =>
            choice(
                seq('"', repeat(choice(alias(/[^"{]+/, $.attribute_value), $.expression)), '"'),
                seq("'", repeat(choice(alias(/[^'{]+/, $.attribute_value), $.expression)), "'"),
            ),

        // `{...props}`. The scanner takes the whole run including the dots, so the spread reads as
        // one expression rather than as a punctuation token the TypeScript injection would then have
        // to be given separately.
        spread_attribute: ($) => $.expression,

        // --- holes ---------------------------------------------------------

        expression: ($) => seq('{', optional($.expression_text), '}'),

        // --- control flow --------------------------------------------------
        //
        // `{#…}` opens, `{:…}` branches, `{/…}` closes — and each block names itself in its own
        // closing token, so `{/for}` cannot close an `{#if}` here any more than it can there.

        if_block: ($) => seq($.if_start, repeat($._node), repeat($.else_branch), $.if_end),
        if_start: ($) => seq('{#', 'if', $.expression_text, '}'),
        else_branch: ($) => seq($.else_marker, repeat($._node)),
        else_marker: ($) => seq('{:', 'else', optional(seq('if', $.expression_text)), '}'),
        if_end: () => seq('{/', 'if', '}'),

        // `{#for item, i of list by key}`, and `{#for await …}` for a stream. The bindings are one
        // token because they may be a destructuring pattern — `parseFor` splits on the LAST comma
        // rather than assuming two names — and the list stops at a top-level `by`, which is the one
        // word the scanner has to know about.
        for_block: ($) => seq($.for_start, repeat($._node), repeat($.catch_branch), $.for_end),
        for_start: ($) =>
            seq(
                '{#',
                'for',
                optional('await'),
                $.binding_text,
                'of',
                $.list_text,
                optional(seq('by', $.expression_text)),
                '}',
            ),
        for_end: () => seq('{/', 'for', '}'),

        switch_block: ($) =>
            seq(
                $.switch_start,
                repeat($._node),
                repeat(choice($.case_branch, $.default_branch)),
                $.switch_end,
            ),
        switch_start: ($) => seq('{#', 'switch', $.expression_text, '}'),
        case_branch: ($) => seq($.case_marker, repeat($._node)),
        case_marker: ($) => seq('{:', 'case', $.expression_text, '}'),
        default_branch: ($) => seq($.default_marker, repeat($._node)),
        default_marker: () => seq('{:', 'default', '}'),
        switch_end: () => seq('{/', 'switch', '}'),

        try_block: ($) =>
            seq($.try_start, repeat($._node), repeat(choice($.catch_branch, $.finally_branch)), $.try_end),
        try_start: () => seq('{#', 'try', '}'),
        finally_branch: ($) => seq($.finally_marker, repeat($._node)),
        finally_marker: () => seq('{:', 'finally', '}'),
        try_end: () => seq('{/', 'try', '}'),

        // Shared by `{#try}` and by a streaming `{#for}` — `BRANCHES` gives `catch` to both.
        catch_branch: ($) => seq($.catch_marker, repeat($._node)),
        catch_marker: ($) => seq('{:', 'catch', optional($.identifier), '}'),

        component_block: ($) => seq($.component_define, repeat($._node), $.component_block_end),
        // The parameter list is NOT an `expression_text` in the tree even though the scanner finds it
        // the same way: `(title: string)` is a signature rather than an expression, so injecting it
        // as one would report an error against text that is perfectly correct.
        component_define: ($) =>
            seq('{#', 'component', $.component_name, alias($.expression_text, $.parameters), '}'),
        component_block_end: () => seq('{/', 'component', '}'),

        identifier: () => /[A-Za-z_$][\w$]*/,

        // Neither `<` nor `{`, and never opening or closing on whitespace — the runs between them are
        // what `extras` takes.
        text: () => /[^<{\s][^<{]*/,
    },
})
