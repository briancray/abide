/**
 * @file The `.abide` grammar: HTML, with `{…}` slots and `{#…}` blocks.
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// A `.abide` file IS HTML — `<script>` and `<style>` blocks, elements, attributes, text — so the HTML
// grammar is the base and every rule of it stands. What abide adds is written here:
//
//   {expr}                         a slot, anywhere text or an attribute value can be (32.1, 32.3)
//   attr={expr}  {...expr}         an expression attribute and a spread (32.11)
//   {#if c}…{:else if c}…{:else}…{/if}
//   {#for item, index of list by key}…{/for}
//   {#try}…{:catch error}…{:finally}…{/try}
//   {#component Name(pattern)}…{/component}
//
// What stands between the braces is `code`, which the external scanner reads by balancing braces
// around strings, template literals and comments — the one thing a regular expression cannot do.
// It is TypeScript to anything that highlights it, a `{#for}` header aside.

const HTML = require('tree-sitter-html/grammar')

module.exports = grammar(HTML, {
    name: 'abide',

    externals: ($, original) => original.concat([$.code]),

    rules: {
        _node: ($, original) =>
            choice(
                original,
                $.expression,
                $.if_block,
                $.for_block,
                $.try_block,
                $.component_block,
            ),

        expression: ($) => seq('{', optional($.code), '}'),

        if_block: ($) =>
            seq(
                $.if_start,
                repeat($._node),
                repeat($.else_if_clause),
                optional($.else_clause),
                $.if_end,
            ),
        if_start: ($) =>
            seq(keyword($, '{#if'), field('condition', $.code), '}'),
        else_if_clause: ($) => seq($.else_if_start, repeat($._node)),
        else_if_start: ($) =>
            seq(
                alias(token(seq('{:else', /\s+/, 'if')), $.block_keyword),
                field('condition', $.code),
                '}',
            ),
        else_clause: ($) => seq($.else_start, repeat($._node)),
        else_start: ($) => seq(keyword($, '{:else'), '}'),
        if_end: ($) => seq(keyword($, '{/if'), '}'),

        for_block: ($) => seq($.for_start, repeat($._node), $.for_end),
        for_start: ($) =>
            seq(keyword($, '{#for'), field('header', $.code), '}'),
        for_end: ($) => seq(keyword($, '{/for'), '}'),

        try_block: ($) =>
            seq(
                $.try_start,
                repeat($._node),
                optional($.catch_clause),
                optional($.finally_clause),
                $.try_end,
            ),
        try_start: ($) => seq(keyword($, '{#try'), '}'),
        catch_clause: ($) => seq($.catch_start, repeat($._node)),
        catch_start: ($) =>
            seq(keyword($, '{:catch'), optional(field('error', $.code)), '}'),
        finally_clause: ($) => seq($.finally_start, repeat($._node)),
        finally_start: ($) => seq(keyword($, '{:finally'), '}'),
        try_end: ($) => seq(keyword($, '{/try'), '}'),

        component_block: ($) =>
            seq($.component_start, repeat($._node), $.component_end),
        component_start: ($) =>
            seq(keyword($, '{#component'), field('signature', $.code), '}'),
        component_end: ($) => seq(keyword($, '{/component'), '}'),

        attribute: ($) =>
            choice(
                seq(
                    $.attribute_name,
                    optional(
                        seq(
                            '=',
                            choice(
                                $.attribute_value,
                                $.quoted_attribute_value,
                                $.expression,
                            ),
                        ),
                    ),
                ),
                $.spread,
            ),

        spread: ($) => seq('{', '...', $.code, '}'),

        // A quoted value may hold slots: `class="badge {tone}"` (32.3).
        quoted_attribute_value: ($) =>
            choice(
                seq(
                    "'",
                    repeat(
                        choice(
                            alias(/[^'{]+/, $.attribute_value),
                            $.expression,
                        ),
                    ),
                    "'",
                ),
                seq(
                    '"',
                    repeat(
                        choice(
                            alias(/[^"{]+/, $.attribute_value),
                            $.expression,
                        ),
                    ),
                    '"',
                ),
            ),

        attribute_name: (_) => /[^<>{}"'/=\s]+/,

        attribute_value: (_) => /[^<>{}"'=\s]+/,

        text: (_) => /[^<>{}&\s]([^<>{}&]*[^<>{}&\s])?/,
    },
})

// A block's opening — `{#if`, `{:else`, `{/for` — as ONE token, brace and word together, so a `{`
// is a slot's or a block's by the longest match rather than by a second token of lookahead.
function keyword($, word) {
    return alias(word, $.block_keyword)
}
