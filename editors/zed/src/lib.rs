// `abide lsp` (RULEBOOK 38.11), started for Zed. The server finds each document's app itself, so
// what this decides is only which `abide` to run: the one the settings name, the one the project
// installed, or the one on the PATH — in that order, so a project's own version wins over a global.
use zed_extension_api::{self as zed, settings::LspSettings, LanguageServerId, Result};

struct AbideExtension;

// Where a project that depends on abide has its command. It is a Bun script, so Bun runs it.
const INSTALLED: &str = "node_modules/.bin/abide";

impl zed::Extension for AbideExtension {
    fn new() -> Self {
        AbideExtension
    }

    fn language_server_command(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let env = worktree.shell_env();

        // `"lsp": { "abide": { "binary": { "path": …, "arguments": […] } } }` in Zed's settings.
        if let Some(binary) = LspSettings::for_worktree(language_server_id.as_ref(), worktree)
            .ok()
            .and_then(|settings| settings.binary)
        {
            if let Some(path) = binary.path {
                return Ok(zed::Command {
                    command: path,
                    args: binary.arguments.unwrap_or_else(|| vec!["lsp".into()]),
                    env,
                });
            }
        }

        if worktree.read_text_file(INSTALLED).is_ok() {
            if let Some(bun) = worktree.which("bun") {
                return Ok(zed::Command {
                    command: bun,
                    args: vec![
                        format!("{}/{}", worktree.root_path(), INSTALLED),
                        "lsp".into(),
                    ],
                    env,
                });
            }
        }

        if let Some(abide) = worktree.which("abide") {
            return Ok(zed::Command {
                command: abide,
                args: vec!["lsp".into()],
                env,
            });
        }

        Err(format!(
            "abide: no `abide` to run. Install abide in this project ({INSTALLED}, with bun on the PATH), put `abide` on the PATH, or set lsp.abide.binary.path in Zed's settings."
        ))
    }
}

zed::register_extension!(AbideExtension);
