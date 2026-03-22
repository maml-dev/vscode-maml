# MAML for Visual Studio Code

Language support for [MAML](https://maml.dev) (Minimal Abstract Markup Language).

## Features

- **Syntax highlighting** — full TextMate grammar for `.maml` files
- **Validation** — real-time parse error diagnostics
- **Formatting** — format documents with consistent style (`Shift+Alt+F`)
- **Document outline** — navigate keys and structure via the Outline panel (`Ctrl+Shift+O`)
- **Folding** — collapse objects, arrays, and raw strings
- **Hover** — type and value information on hover
- **Completion** — keywords (`true`, `false`, `null`), structure snippets, and known keys from the document
- **Bracket matching** — auto-close `{}`, `[]`, `""`
- **Comment toggling** — toggle `#` line comments (`Ctrl+/`)

## Settings

| Setting | Default | Description |
|---|---|---|
| `maml.validate` | `true` | Enable/disable validation diagnostics |
| `maml.format.enable` | `true` | Enable/disable document formatting |

## What is MAML?

MAML is a minimal, human-readable data format. Think JSON, but cleaner:

```maml
{
  project: "MAML"
  tags: [
    "minimal"
    "readable"
  ]

  # Comments are supported
  spec: {
    version: 1
    author: "Anton Medvedev"
  }

  notes: """
Raw multiline strings.
No escaping needed.
"""
}
```

Key differences from JSON:
- `#` comments
- Unquoted keys
- Optional commas (newlines work as separators)
- Raw multiline strings with `"""`
- No trailing comma errors

Learn more at [maml.dev](https://maml.dev).

## Development

```sh
npm install
npm run build
npm run watch   # rebuild on changes
npm run lint    # type-check
```

To test locally, press `F5` in VS Code to open an Extension Development Host.

## License

MIT
