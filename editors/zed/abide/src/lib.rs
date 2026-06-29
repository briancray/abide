use zed_extension_api::{self as zed, LanguageServerId, Result};

/*
The Abide Zed extension. Registers the `.abide` language (tree-sitter-html for
`<script>`→TS / `<style>`→CSS injections and as the no-LSP fallback; the markup
structure and all abide-specific syntax highlighted by `abide lsp` via LSP semantic
tokens) and spawns `abide lsp` as its language server, which publishes the template
+ prop type-check diagnostics produced by the shadow type-checker.
*/
struct AbideExtension;

impl AbideExtension {
    /*
    Resolves the command that runs the language server. Every launched path is
    absolute so the worktree's cwd never decides whether the entrypoint resolves
    — the original bug was a worktree-relative script path that only existed when
    the worktree happened to be the abide monorepo. Order:
      1. A `abide` binary on PATH (a global install).
      2. The abide monorepo itself, detected by probing the in-repo CLI through
         `read_text_file` — that file is git-tracked, so it is in the worktree
         snapshot `read_text_file` reads from. Run it through `bun` so live source
         edits take effect without an extension rebuild.
      3. A consumer project's local install at `<root>/node_modules/.bin/abide`, a
         bun-shebang script. This is the unconditional fallback: it can't be probed
         because `node_modules` is gitignored and therefore absent from the worktree
         snapshot (the prior bug — probing it always failed in consumer projects, so
         resolution fell through to candidate 2's monorepo-only path). A missing
         install surfaces as a clear spawn error instead.
    */
    fn server_command(worktree: &zed::Worktree) -> Result<zed::Command> {
        let env = worktree.shell_env();
        if let Some(abide) = worktree.which("abide") {
            return Ok(zed::Command {
                command: abide,
                args: vec!["lsp".to_string()],
                env,
            });
        }
        let root = worktree.root_path();
        /* `read_text_file` resolves against the worktree root and rejects an
           absolute path, so probe with the relative path; the launched command
           stays absolute so the process's cwd never decides resolution. */
        if worktree.read_text_file("packages/abide/bin/abide.ts").is_ok() {
            let bun = worktree
                .which("bun")
                .ok_or_else(|| "abide LSP needs `bun` on PATH".to_string())?;
            return Ok(zed::Command {
                command: bun,
                args: vec![
                    format!("{root}/packages/abide/bin/abide.ts"),
                    "lsp".to_string(),
                ],
                env,
            });
        }
        Ok(zed::Command {
            command: format!("{root}/node_modules/.bin/abide"),
            args: vec!["lsp".to_string()],
            env,
        })
    }
}

impl zed::Extension for AbideExtension {
    fn new() -> Self {
        AbideExtension
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        AbideExtension::server_command(worktree)
    }
}

zed::register_extension!(AbideExtension);
