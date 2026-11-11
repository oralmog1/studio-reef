#!/bin/zsh
# Builds Reef Widget, installs it in ~/Applications (so it's in Launchpad and
# Spotlight, and can be dragged to the Dock), puts a shortcut on the Desktop,
# and (re)starts it: a running widget is quit first.
# Needs only the Xcode Command Line Tools (swiftc) and Node. Re-run after
# moving the project folder: the app remembers where the project lives.
set -e
cd "$(dirname "$0")"
PROJECT="$(cd .. && pwd)"
NODE="$(command -v node)"
NAME="Reef Widget"
APP="$HOME/Applications/$NAME.app"
SHORTCUT="$HOME/Desktop/$NAME"

# 1. quit a running widget (it stops its own server on the way out)
if pgrep -x ReefWidget >/dev/null; then
  echo "Quitting the running widget…"
  pkill -TERM -x ReefWidget || true
  for i in {1..50}; do pgrep -x ReefWidget >/dev/null || break; sleep 0.1; done
fi
# safety net: a server left behind (e.g. by an older build) would block port 5199
pkill -f "vite.js --port 5199" 2>/dev/null || true
for i in {1..50}; do lsof -nP -iTCP:5199 -sTCP:LISTEN >/dev/null 2>&1 || break; sleep 0.1; done

# 2. build and sign in a temporary folder: on the Desktop, Finder/iCloud keep
#    adding file metadata that makes signing fail
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
B="$TMP/$NAME.app"
mkdir -p "$B/Contents/MacOS" "$B/Contents/Resources"
swiftc -O ReefWidget.swift -o "$B/Contents/MacOS/ReefWidget" -framework AppKit -framework WebKit
sed -e "s|__PROJECT__|$PROJECT|" -e "s|__NODE__|$NODE|" Info.plist.template > "$B/Contents/Info.plist"
swift makeIcon.swift "$TMP/AppIcon.iconset"
iconutil -c icns "$TMP/AppIcon.iconset" -o "$B/Contents/Resources/AppIcon.icns"
codesign --force --sign - "$B" 2>/dev/null

# 3. install
mkdir -p "$HOME/Applications"
rm -rf "$APP"
ditto --noextattr --noqtn "$B" "$APP"
rm -rf "$NAME.app" # older builds lived next to this script
touch "$APP"       # nudge Finder/Launchpad to pick up the icon
echo "Installed: $APP  (project: $PROJECT, node: $NODE)"

# 4. Desktop shortcut: made the first time only. If you delete it, it stays deleted.
MARK="$HOME/Library/Application Support/Reef Widget/shortcut-made"
if [ ! -e "$MARK" ]; then
  [ -e "$SHORTCUT" ] || [ -L "$SHORTCUT" ] || ln -s "$APP" "$SHORTCUT"
  mkdir -p "$(dirname "$MARK")" && touch "$MARK"
  echo "Shortcut: $SHORTCUT"
fi

# 5. Reef Helper (runs the server, follows the chat apps): rebuilt only when
#    its source changed, because macOS ties its Desktop-folder and
#    Accessibility permissions to the exact build
W="$HOME/Applications/Reef Helper.app"
SUM="$( (cat ReefHelper.swift; echo "$PROJECT $NODE") | shasum -a 256 | cut -d' ' -f1)"
pkill -TERM -x ReefChatWatcher 2>/dev/null || true; rm -rf "$HOME/Applications/Reef Chat Watcher.app" # old name
if [ "$(cat "$W/Contents/Resources/source.sha256" 2>/dev/null)" != "$SUM" ]; then
  pkill -TERM -x ReefHelper 2>/dev/null || true
  WB="$TMP/Reef Helper.app"
  mkdir -p "$WB/Contents/MacOS" "$WB/Contents/Resources"
  swiftc -O ReefHelper.swift -o "$WB/Contents/MacOS/ReefHelper" -framework AppKit -framework ApplicationServices
  cp "$B/Contents/Resources/AppIcon.icns" "$WB/Contents/Resources/"
  sed -e 's|<string>Reef Widget</string>|<string>Reef Helper</string>|g' \
      -e 's|local.studio-reef.widget|local.studio-reef.helper|' \
      -e 's|<string>ReefWidget</string>|<string>ReefHelper</string>|' \
      -e "s|__PROJECT__|$PROJECT|" -e "s|__NODE__|$NODE|" Info.plist.template > "$WB/Contents/Info.plist"
  echo "$SUM" > "$WB/Contents/Resources/source.sha256"
  codesign --force --sign - "$WB" 2>/dev/null
  rm -rf "$W"
  ditto --noextattr --noqtn "$WB" "$W"
  echo "Installed: $W (new build: macOS will ask for its permissions once)"
fi

# 6. start the new build
open "$APP"
echo "Reef Widget started."
