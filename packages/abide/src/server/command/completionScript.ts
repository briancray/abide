// completionScript(shell, binary) — the shell snippet that wires TAB completion to the binary itself.
//
// DYNAMIC, not generated-static. The obvious alternative is to bake the command and flag names into
// the script at generation time, and it is wrong here: the binary IS the app, so its command table
// changes whenever the app does, and a baked script goes stale the moment a handler gains a field.
// Every one of these delegates back to `<binary> completion --line <line>`, which answers from the
// live input schemas — the same call the REPL's TAB makes, so the two surfaces cannot disagree.
//
// The cost of dynamic completion is one process spawn per TAB. That is the right trade for a CLI that
// already boots nothing to print help: `completion --line` resolves the command table from the
// embedded app and exits without running `onStart`.
export type CompletionShell = 'bash' | 'zsh' | 'fish'

export const COMPLETION_SHELLS: CompletionShell[] = ['bash', 'zsh', 'fish']

export function completionScript(shell: CompletionShell, binary: string): string {
    // The invoked name, not the path: `complete` registers against the word you type.
    const name = binary
    if (shell === 'bash') {
        return `# ${name} completion (bash) — eval "$(${name} completion bash)"
_${name}_complete() {
  local line="\${COMP_LINE:0:\${COMP_POINT}}"
  # Drop the program name: the completer answers about the COMMAND line, not the invocation.
  line="\${line#* }"
  [[ "$COMP_LINE" == "$line" ]] && line=""
  local IFS=$'\\n'
  COMPREPLY=( $(${name} completion --line "$line" 2>/dev/null) )
}
complete -o default -F _${name}_complete ${name}
`
    }
    if (shell === 'zsh') {
        return `# ${name} completion (zsh) — eval "$(${name} completion zsh)"
_${name}_complete() {
  local line="\${words[2,CURRENT]}"
  [[ $CURRENT -le 1 ]] && line=""
  local -a candidates
  candidates=(\${(f)"$(${name} completion --line "$line" 2>/dev/null)"})
  # -U: the candidates are already filtered on the prefix by the completer itself.
  compadd -U -- $candidates
}
compdef _${name}_complete ${name}
`
    }
    return `# ${name} completion (fish) — ${name} completion fish | source
function __${name}_complete
  set -l line (commandline -cp)
  # Strip the program name; everything after it is the command line the completer reasons about.
  set -l rest (string replace -r '^\\s*\\S+\\s*' '' -- $line)
  ${name} completion --line "$rest" 2>/dev/null
end
complete -c ${name} -f -a '(__${name}_complete)'
`
}
