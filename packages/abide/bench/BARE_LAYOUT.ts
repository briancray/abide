/** A layout wrapping a page in a bare document and nothing else: no stylesheet, no script of its own. */
export const BARE_LAYOUT = `<html lang="en">
<head>
    <meta charset="utf-8" />
</head>
<body>
    <slot/>
</body>
</html>`
