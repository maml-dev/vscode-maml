# Releasing vscode-maml

## Prerequisites

1. Install the VS Code Extension CLI:

   ```sh
   npm install -g @vscode/vsce
   ```

2. Create a publisher on the [VS Code Marketplace](https://marketplace.visualstudio.com/manage).

3. Create a Personal Access Token (PAT) in [Azure DevOps](https://dev.azure.com) with the **Marketplace (Manage)** scope.

## Publishing

### 1. Bump the version

```sh
npm version patch   # or minor / major
```

### 2. Build

```sh
npm run build
```

### 3. Package the VSIX

```sh
vsce package
```

This creates `vscode-maml-<version>.vsix`. Inspect it to verify only the intended files are included:

```sh
vsce ls
```

### 4. Publish to VS Code Marketplace

```sh
vsce publish
```

Or publish a specific VSIX:

```sh
vsce publish --packagePath vscode-maml-<version>.vsix
```

### 5. Publish to Open VSX (optional)

```sh
npm install -g ovsx
ovsx publish vscode-maml-<version>.vsix -p <OVSX_TOKEN>
```

## Installing from VSIX (local / CI)

```sh
code --install-extension vscode-maml-<version>.vsix
```

## Pre-release versions

To publish a pre-release:

```sh
vsce publish --pre-release
```

## Checklist

- [ ] Version bumped in `package.json`
- [ ] `CHANGELOG.md` updated
- [ ] `npm run build` succeeds
- [ ] `npm run lint` passes
- [ ] `vsce ls` output looks correct (no extra files)
- [ ] `vsce package` creates a valid VSIX
- [ ] Tested in Extension Development Host (`F5`)
- [ ] Published to Marketplace
- [ ] Git tag created: `git tag v<version> && git push --tags`
