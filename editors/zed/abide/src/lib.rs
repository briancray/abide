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
    Resolves the command that runs the language server. Every candidate is an
    absolute path so the worktree's cwd never decides whether the entrypoint
    resolves — the original bug was a worktree-relative script path that only
    existed when the worktree happened to be the abide monorepo. Order:
      1. A `abide` binary on PATH (a global install).
      2. The project's local install at `<root>/node_modules/.bin/abide` — a
         bun-shebang script present in consumer projects and, via the workspace
         symlink, in the abide monorepo itself. `which` misses it because
         `node_modules/.bin` is not on the shell PATH.
      3. The in-repo CLI through `bun` — developing abide before its workspace
         symlinks exist.
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
        let relative_bin = "node_modules/.bin/abide";
        if worktree.read_text_file(relative_bin).is_ok() {
            return Ok(zed::Command {
                command: format!("{root}/{relative_bin}"),
                args: vec!["lsp".to_string()],
                env,
            });
        }
        let bun = worktree
            .which("bun")
            .ok_or_else(|| "abide LSP needs `abide` or `bun` on PATH".to_string())?;
        Ok(zed::Command {
            command: bun,
            args: vec![
                format!("{root}/packages/abide/bin/abide.ts"),
                "lsp".to_string(),
            ],
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
