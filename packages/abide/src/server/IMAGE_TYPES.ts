/**
 * The image types a model is shown (44.36). A leaf, because `assistant` refuses a transcript image of
 * any other and `/__abide/mcp` answers one of any other as its text (20.21).
 */
export const IMAGE_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
])
