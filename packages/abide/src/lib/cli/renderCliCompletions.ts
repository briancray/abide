/*
The shell-completion script for a standalone CLI binary. Emits a thin
wrapper that shells back into the binary's `/completions --query` on every
tab — so the candidate list always reflects the manifest baked into the
running binary (rebuild the binary and completion updates, no re-source).
Returns undefined for an unrecognised shell so the caller can error. The
`\0` sentinel below is the program name, substituted once here rather than
threaded through every heredoc line.
*/
export function renderCliCompletions(
    programName: string,
    shell: string | undefined,
): string | undefined {
    const script = SCRIPTS[shell ?? '']
    if (!script) {
        return undefined
    }
    return script.replaceAll('\0', programName)
}

/*
One wrapper per shell. Each forwards the tokens typed so far — the cursor
index and the command word (`words[1]`) — to `\0 /completions --query`,
then lets the shell filter the newline-separated candidates by the current
prefix. `2>/dev/null` keeps a connection error off the completion output.
The index is normalised to bash's 0-based `COMP_CWORD` convention (program =
0, first positional = 1) that `completeCli` expects: zsh's `$CURRENT` is
1-based (`words[1]` is the program), so it forwards `CURRENT - 1`.
*/
const SCRIPTS: Record<string, string> = {
    bash: `_\0_complete() {
  local cur cmd candidates
  cur="\${COMP_WORDS[COMP_CWORD]}"
  cmd="\${COMP_WORDS[1]}"
  candidates="$(\0 /completions --query "\${COMP_CWORD}" "\${cmd}" 2>/dev/null)"
  COMPREPLY=( $(compgen -W "\${candidates}" -- "\${cur}") )
}
complete -F _\0_complete \0
`,
    zsh: `#compdef \0
_\0() {
  local cmd="\${words[2]}"
  local -a candidates
  candidates=("\${(@f)$(\0 /completions --query "\$((CURRENT - 1))" "\${cmd}" 2>/dev/null)}")
  compadd -- "\${candidates[@]}"
}
compdef _\0 \0
`,
    fish: `function __\0_complete
  set -l words (commandline -opc)
  set -l cword (count $words)
  \0 /completions --query (math $cword) $words[2] 2>/dev/null
end
complete -c \0 -f -a '(__\0_complete)'
`,
}
