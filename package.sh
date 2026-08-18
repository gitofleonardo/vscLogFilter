#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

RUN_TEST=false
INSTALL=false
EDITOR="code"

usage() {
  cat <<'EOF'
Usage: ./package.sh [options]

Build and package the VS Code extension (.vsix).

Options:
  --test      Run npm test before packaging
  --install   Install the VSIX into VS Code after packaging
  --cursor    Use the cursor CLI with --install (default: code)
  --code      Same as default; use the code CLI
  -h, --help  Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --test) RUN_TEST=true; shift ;;
    --install) INSTALL=true; shift ;;
    --cursor) EDITOR="cursor"; shift ;;
    --code) EDITOR="code"; shift ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -f /etc/proxysource.sh ]]; then
  source /etc/proxysource.sh
fi

if [[ ! -d node_modules ]]; then
  echo "==> npm install"
  npm install
fi

echo "==> npm run build"
npm run build

if [[ "$RUN_TEST" == true ]]; then
  echo "==> npm test"
  npm test
fi

echo "==> vsce package"
npx @vscode/vsce package --allow-missing-repository --no-dependencies

VSIX="$ROOT/$(node -p "require('./package.json').name + '-' + require('./package.json').version + '.vsix'")"

if [[ ! -f "$VSIX" ]]; then
  echo "VSIX not found: $VSIX" >&2
  exit 1
fi

echo "==> Done: $VSIX"

if [[ "$INSTALL" == true ]]; then
  if ! command -v "$EDITOR" >/dev/null 2>&1; then
    echo "$EDITOR not found, skipping install" >&2
    exit 1
  fi
  echo "==> $EDITOR --install-extension"
  "$EDITOR" --install-extension "$VSIX" --force
fi
