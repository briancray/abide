---
"@abide/abide": minor
---

tools answer images — a handler whose answer is a png, jpeg, gif or webp body reaches a model as the image: `/__abide/mcp` carries it as an `image` content item (so Claude Code, through a bridge, sees it), and a `Toolbox` call answers a `ToolAnswer` of `content` — the same pieces, text or image — which `claudeApi` shows the model as the call's result. Any other image type, an svg, is answered as its text. Breaking for a hand-written `Provider`: a `ToolAnswer` is `{ content, failed }` where it was `{ text, failed }`. RULEBOOK 20.21, 44.35
