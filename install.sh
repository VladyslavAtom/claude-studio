#!/usr/bin/env bash
# Install or update Claude Studio from source, then start it. Linux only.
#
#   curl -fsSL https://raw.githubusercontent.com/VladyslavAtom/claude-studio/main/install.sh | bash
#
# The checkout goes to $CLAUDE_STUDIO_DIR (default ~/.local/share/claude-studio); a second run
# pulls it. claude-studio.sh then installs the dependencies, builds and starts the app.

# Everything is inside main, called on the last line: under `curl | bash` the script is still
# being read from stdin, and a half-downloaded script must not run its first half.
main() {
  set -euo pipefail
  local repo=https://github.com/VladyslavAtom/claude-studio
  local dir="${CLAUDE_STUDIO_DIR:-$HOME/.local/share/claude-studio}"

  die() { echo "claude-studio install: $*" >&2; exit 1; }
  [ "$(uname -s)" = Linux ] || die "Linux only for now; elsewhere clone $repo and see the README"
  command -v git >/dev/null || die "git is required"
  command -v node >/dev/null || die "Node.js 22.5+ is required"
  node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 5) ? 0 : 1)' \
    || die "Node.js 22.5+ is required, found $(node -v)"

  if [ -d "$dir/.git" ]; then
    echo "updating $dir"
    git -C "$dir" pull --ff-only
  else
    echo "cloning into $dir"
    git clone --depth 1 "$repo" "$dir"
  fi

  mkdir -p "$HOME/.local/bin"
  ln -sf "$dir/claude-studio.sh" "$HOME/.local/bin/claude-studio"
  "$dir/claude-studio.sh" --desktop </dev/null
  # stdin is the downloaded script: nothing below may read it
  "$dir/claude-studio.sh" </dev/null

  echo "installed: run 'claude-studio' (~/.local/bin) or use the application menu"
}

main "$@"
