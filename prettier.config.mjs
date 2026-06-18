/*
Prettier is used ONLY for `.abide` single-file components, via
@abide/prettier-plugin-abide — Biome (see biome.json) remains the formatter for
every other file and excludes `.abide` because it can't map the custom extension to
a parser. The style here mirrors biome.json's JavaScript formatter so the
TypeScript inside a component matches the rest of the repo. The repo's `format`
script only ever runs Prettier over .abide files.
*/
export default {
    plugins: ['@abide/prettier-plugin-abide'],
    printWidth: 100,
    tabWidth: 4,
    useTabs: false,
    semi: false,
    singleQuote: true,
    trailingComma: 'all',
    arrowParens: 'always',
}
