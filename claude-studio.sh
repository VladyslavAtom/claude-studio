#!/usr/bin/env bash
# Start Claude Studio: installs what is missing, rebuilds when sources changed, starts the app.
#
#   ./claude-studio.sh            start in the background (log: ~/.local/state/claude-studio/app.log)
#   ./claude-studio.sh -f         start in the foreground
#   ./claude-studio.sh --dev      development mode (renderer HMR)
#   ./claude-studio.sh --stop     stop the running instance
#   ./claude-studio.sh --logs     show the tail of the log and follow it
#   ./claude-studio.sh --rebuild  reinstall dependencies and rebuild node-pty for Electron
#   ./claude-studio.sh --desktop  add a launcher to the application menu and the desktop

set -euo pipefail

APP_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/claude-studio"
LOG="$STATE_DIR/app.log"
PIDFILE="$STATE_DIR/app.pid"
MODE="background"

mkdir -p "$STATE_DIR"
cd "$APP_DIR"

die() {
  echo "claude-studio: $*" >&2
  # started from the launcher, stderr is shown to nobody: without a notification the failure
  # looks like «nothing happened»
  if [ ! -t 2 ] && command -v notify-send >/dev/null 2>&1; then
    notify-send -a "Claude Studio" -u critical "Claude Studio failed to start" "$* (log: $LOG)"
  fi
  exit 1
}

# `kill -0` only answers «some process holds this pid», and pids are recycled: the pid of a
# finished app came back as a Chrome renderer, after which every launch printed «already running»
# and exited 0 — from the shortcut that is no window, no error and nothing in the log. The
# command line has to be our electron as well, and a pidfile that fails the check is stale and
# gets removed rather than blocking the next start.
running_pid() {
  [ -f "$PIDFILE" ] || return 1
  local pid
  pid="$(cat "$PIDFILE" 2>/dev/null || true)"
  if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$PIDFILE"
    return 1
  fi
  # matched at the start of the line, i.e. against argv[0]: any shell that merely mentions the
  # path — this script, an editor, an agent — carries it somewhere in its own command line
  case "$(ps -p "$pid" -o args= 2>/dev/null)" in
    "$APP_DIR/node_modules/electron/dist/electron"*) ;;
    *)
      rm -f "$PIDFILE"
      return 1
      ;;
  esac
  echo "$pid"
}

stop_app() {
  local pid
  if pid="$(running_pid)"; then
    pkill -P "$pid" 2>/dev/null || true
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.25
    done
    kill -9 "$pid" 2>/dev/null || true
    rm -f "$PIDFILE"
    echo "stopped (pid $pid)"
  else
    echo "not running"
  fi
}

# A launcher from the menu starts with a minimal PATH, which holds no node from nvm/fnm/asdf —
# the app died with «node is required» while everything worked in a terminal. So look for it.
find_node() {
  command -v node >/dev/null && return 0
  local dir
  for dir in \
    "${NVM_DIR:-$HOME/.nvm}/versions/node"/*/bin \
    "$HOME/.local/share/fnm/node-versions"/*/installation/bin \
    "$HOME/.asdf/installs/nodejs"/*/bin \
    "$HOME/.volta/bin" \
    /usr/local/bin; do
    [ -x "$dir/node" ] || continue
    PATH="$dir:$PATH"
  done
  export PATH
  command -v node >/dev/null
}

ensure_deps() {
  find_node || die "node is required"
  command -v npm >/dev/null || die "npm is required"

  if [ ! -d node_modules ]; then
    echo "installing dependencies…"
    npm install
  fi

  # electron downloads its binary in a step of its own, and sometimes skips it
  if [ ! -x node_modules/electron/dist/electron ]; then
    echo "downloading the electron binary…"
    node node_modules/electron/install.js
  fi

  # node-pty is native: rebuild it when there is no build for the current ABI
  if [ ! -f node_modules/node-pty/build/Release/pty.node ]; then
    echo "rebuilding node-pty for electron…"
    npm run rebuild
  fi
}

needs_build() {
  [ -f out/main/index.js ] || return 0
  # any source newer than the built main means a rebuild
  [ -n "$(find src electron.vite.config.ts package.json -newer out/main/index.js -print -quit 2>/dev/null)" ]
}

# The launcher: the icon goes into the hicolor theme, the .desktop into the application menu and
# onto the desktop. StartupWMClass is what makes the window stick to its own icon in the taskbar.
install_desktop() {
  local apps="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
  local icons="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor"
  local entry="$apps/claude-studio.desktop"

  mkdir -p "$apps" "$icons/scalable/apps"
  install -m 644 "$APP_DIR/resources/icon.svg" "$icons/scalable/apps/claude-studio.svg"
  for size in 32 48 64 128 256; do
    mkdir -p "$icons/${size}x${size}/apps"
    install -m 644 "$APP_DIR/resources/icon-$size.png" "$icons/${size}x${size}/apps/claude-studio.png"
  done
  mkdir -p "$icons/512x512/apps"
  install -m 644 "$APP_DIR/resources/icon.png" "$icons/512x512/apps/claude-studio.png"
  command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -qtf "$icons" 2>/dev/null || true

  cat >"$entry" <<EOF
[Desktop Entry]
Type=Application
Name=Claude Studio
Comment=Agent sessions in parallel: worktrees, changes, terminals
Exec=$APP_DIR/claude-studio.sh
Icon=claude-studio
Terminal=false
Categories=Development;Utility;
StartupWMClass=claude-studio
EOF
  chmod +x "$entry"

  # the desktop directory is named differently depending on the locale
  local desktop_dir
  desktop_dir="$(xdg-user-dir DESKTOP 2>/dev/null || true)"
  [ -n "$desktop_dir" ] && [ -d "$desktop_dir" ] || desktop_dir="$HOME/Desktop"
  if [ -d "$desktop_dir" ]; then
    install -m 755 "$entry" "$desktop_dir/claude-studio.desktop"
    # KDE starts a launcher without questions only when the file is trusted
    command -v kwriteconfig6 >/dev/null 2>&1 &&
      gio set "$desktop_dir/claude-studio.desktop" metadata::trusted true 2>/dev/null || true
    echo "desktop launcher: $desktop_dir/claude-studio.desktop"
  fi
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q "$apps" 2>/dev/null || true
  echo "menu launcher: $entry"
}

while [ $# -gt 0 ]; do
  case "$1" in
    -f | --foreground) MODE="foreground" ;;
    --dev) MODE="dev" ;;
    --stop)
      stop_app
      exit 0
      ;;
    --logs)
      [ -f "$LOG" ] || die "there is no log yet: $LOG"
      tail -n 40 -f "$LOG"
      exit 0
      ;;
    --rebuild)
      npm install
      npm run rebuild
      ;;
    --desktop)
      install_desktop
      exit 0
      ;;
    -h | --help)
      sed -n '2,11p' "$(readlink -f "${BASH_SOURCE[0]}")" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
done

if pid="$(running_pid)"; then
  echo "already running (pid $pid); the window should be open. Stop it with: $0 --stop"
  exit 0
fi

ensure_deps

# Ubuntu 24.04+ forbids unprivileged user namespaces through AppArmor, and the Chromium sandbox
# does not start without them. An AppArmor profile on the binary is the alternative.
export ELECTRON_DISABLE_SANDBOX=1

if [ "$MODE" = "dev" ]; then
  exec npm run dev
fi

if needs_build; then
  # the build is limited in cores and priority: on a loaded machine that is noticeable
  echo "building…"
  npm run build:light
fi

# the binary is started directly: through npx the pid would belong to the wrapper, not to the app
ELECTRON_BIN="$APP_DIR/node_modules/electron/dist/electron"

if [ "$MODE" = "foreground" ]; then
  exec "$ELECTRON_BIN" .
fi

nohup "$ELECTRON_BIN" . >>"$LOG" 2>&1 &
echo $! >"$PIDFILE"
sleep 2
if pid="$(running_pid)"; then
  echo "started (pid $pid), log: $LOG"
else
  tail -n 20 "$LOG" >&2
  die "could not start, details above"
fi
