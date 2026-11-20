// ANSWERS A MODEL WROTE, as it wrote them: three replies from the session that built 52.46-52.50,
// kept verbatim so the renderer is held to what model output actually looks like rather than to
// a sample written to pass.

/** Each answer's markdown, in full. */
export const MODEL_ANSWERS: readonly string[] = [
    `No. Markdown is abide's own code, about 1,000 lines, with no third-party library.

- **The renderer** (\`markdown()\`, in \`shared/markdown/markdown.ts\` and \`sections.ts\`, ~850 lines) imports only one escaping helper from abide (\`escapeText.ts\`). That pulls in two tiny files (\`Raw.ts\`, then the constants in \`ANCHORS.ts\`), and the chain ends there.
- **The \`Markdown\` component** (\`Markdown.abide\`, 150 lines) adds abide's own runtime pieces: \`props\`, \`raw\` and \`reactive\`.

On the package level, \`@abide/abide\` has just two runtime dependencies, \`typescript\` and \`@abide/bridge\`, and markdown uses neither.

So on the docs pages, the extra 5.9 KB per page is all abide code: \`Chat\` (which also pulls in its image-attach, drag-and-drop and auto-scroll helpers), \`Markdown\` and the renderer, and the docs' own Answer components. There's no external parser in there.`,
    `They're built for different jobs. \`marked\` aims for full CommonMark + GFM and leaves safety to you. abide's \`markdown\` is a deliberately smaller dialect that is safe by default and built for streaming.

## Size

| | minified | gzip | brotli |
|---|---|---|---|
| abide \`markdown\` | 9.7 KB | 4.0 KB | **3.7 KB** |
| \`marked\` | 51.5 KB | 15.6 KB | **14.1 KB** |

abide's is about 3.8x smaller. \`marked\` also doesn't sanitize its output, so using it on model or user text in a browser means adding a sanitizer such as DOMPurify.

## Speed (whole document, one render)

| | abide | marked | marked ÷ abide |
|---|---|---|---|
| RULEBOOK.md (273 KB) | 2.9 ms | 17–18 ms | 5.9–6.3x |
| CLAUDE.md (30 KB) | 0.18 ms | 1.9 ms | 10.9x |

**Streaming** a 6 KB answer in 150 chunks of 40 characters:
- \`marked\`, re-rendering the whole text each chunk: **28 ms**.
- abide, re-rendering the whole text: **3.1 ms**.
- abide the way the \`Markdown\` component does it, rendering only the section still growing: **0.55 ms**, about 50x less than \`marked\`.

**Safety.** abide is safe by default; \`marked\` is not.
- \`<script>\` and \`<img onerror>\`: abide escapes them to text, \`marked\` outputs them as live HTML.
- \`[go](javascript:alert(1))\`: abide renders plain text, \`marked\` makes it a link.

**Only abide has:**
- Rendering a fenced block through your own component (\`blocks\`), which the docs' \`show\` blocks use.
- An \`href\` hook that can rewrite or drop each link, or give it a \`target\` and \`rel\`.

## For abide
For what abide uses it for, rendering model and user text in the browser, abide's renderer is the better fit: 3.8x smaller, safe without a sanitizer, and far cheaper while streaming. \`marked\` would only win where you need full CommonMark fidelity or raw HTML, such as rendering trusted docs written by authors.`,
    `Decision 1 is whether to rebuild the docs site's "Ask" bar on the shipped \`Chat\` and \`Markdown\` components, and drop the custom answer pipeline it uses now.

## How it works today

The Ask bar sits at the top of every docs page and sends the visitor's question to their own Claude Code. The answer passes through three custom pieces:

1. **A server-side writer** (\`ask/lib/AnswerWriter.server.ts\`, 135 lines). It cuts Claude's streamed text into blocks as it arrives: prose, code fences, and \`<show …/>\` lines.
2. **A custom wire format** (\`AnswerPart.ts\`). The handler streams \`part\`, \`tail\`, \`tool\`, \`permission\` and \`done\` events rather than the framework's standard assistant events.
3. **Its own UI** (\`lib/Ask.abide\`, 193 lines). It folds the turns, the transcript, the permission prompt and the composer itself.

So:
- \`answer.handler\` would pass the assistant's events straight through.
- \`<show name="reactive"/>\` would become a fenced block such as \`\`\`\` \`\`\`show name="reactive" \`\`\`\`, rendered by a small \`ShowBlock\` that wraps the existing \`Shown\`.

## If you want it done
1. Measure the client-bundle delta of \`Markdown\` first, i.e. the docs app's first-page transfer before and after.
2. Change the \`<show>\` lines to fences in the system prompt, and spot-check a handful of real answers.
3. Then make the swap and delete AnswerWriter and AnswerPart in the same change.

I can do it in that order if you want: measure first, then decide.`,
]
