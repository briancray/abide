import { resolve, sep } from "node:path"
import { error } from "abide/server/error"
import { GET } from "abide/server/GET"
import { codeBlock } from "../../ui/lib/codeBlock"

// Reads a docs source file and extracts the region between demo markers, so a docs page can show the
// REAL demonstrated code (DRY — the snippet is the running source, never a hand-copied duplicate).
// Two marker syntaxes are supported so both `.ts` and `.abide` template regions can be marked:
//   TypeScript:  `// #demo <marker>` … `// #enddemo`
//   Template:    `<!-- #demo <marker> -->` … `<!-- #enddemo -->`
// The extracted region is dedented (common leading indentation stripped) and returned with a `lang`
// hint plus `html` — the server-rendered, syntax-highlighted `<pre class="code">` block. Highlighting
// runs here on the server (never in the browser); a page just injects `html` via `{html(...)}`.
// Path-traversal guarded: only files under docs/src resolve.

const DOCS_ROOT = resolve(import.meta.dir, "../../..")
const SRC_DIR = resolve(DOCS_ROOT, "src")

function langForFile(file: string): string {
  if (file.endsWith(".abide")) return "abide"
  if (file.endsWith(".ts") || file.endsWith(".tsx")) return "ts"
  if (file.endsWith(".js") || file.endsWith(".jsx")) return "js"
  return "text"
}

// Strips the smallest common leading indentation across non-blank lines, then trims blank edges.
function dedent(lines: string[]): string {
  let common = Infinity
  for (const line of lines) {
    if (line.trim() === "") continue
    const indent = line.length - line.trimStart().length
    if (indent < common) common = indent
  }
  if (common === Infinity) common = 0
  const trimmed: string[] = []
  for (const line of lines) trimmed.push(line.slice(common))
  return trimmed.join("\n").trim()
}

const START = /^\s*(?:\/\/|<!--)\s*#demo\s+(\S+)/
const END = /^\s*(?:\/\/|<!--)\s*#enddemo\b/

export default GET(async ({ file, marker }: { file: string; marker?: string }) => {
  const target = resolve(DOCS_ROOT, file)
  if (target !== SRC_DIR && !target.startsWith(SRC_DIR + sep)) {
    return error(400, "file must resolve under src/")
  }
  const source = await Bun.file(target).text()
  const lang = langForFile(file)

  // No marker → return the WHOLE file (used for server RPC/socket source: the file IS the sample).
  if (marker === undefined || marker === "") {
    const code = source.replace(/\s+$/, "")
    return { code, lang, html: codeBlock(code, lang) }
  }

  const lines = source.split("\n")
  const region: string[] = []
  let capturing = false
  for (const line of lines) {
    if (!capturing) {
      const open = line.match(START)
      if (open !== null && open[1] === marker) capturing = true
      continue
    }
    if (END.test(line)) {
      const code = dedent(region)
      return { code, lang, html: codeBlock(code, lang) }
    }
    region.push(line)
  }
  return error(404, `demo marker "${marker}" not found in ${file}`)
})
