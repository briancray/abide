/** NSWindowStyleMask's bits, which a window and the menu bar extra's panel are both set up with. */
export const WINDOW_STYLE = {
    TITLED: 1,
    CLOSABLE: 2,
    MINIATURIZABLE: 4,
    RESIZABLE: 8,
    FULL_SIZE_CONTENT_VIEW: 1 << 15,
} as const
