#!/usr/bin/env bash
# Arrête tout ce que start-demo.sh a lancé : le serveur (port 4242), le
# listener stripe listen, et referme les fenêtres Terminal qu'il a ouvertes.
# Idempotent : peut être relancé même si rien ne tourne.
set -uo pipefail

PORT=4242
TAG_PREFIX="Velvet ·"

echo "──── Arrêt de la démo Velvet ────"

# 1. Serveur Node sur le port 4242 -------------------------------------------
SERVER_PIDS=$(lsof -ti tcp:"$PORT" 2>/dev/null || true)
if [ -n "$SERVER_PIDS" ]; then
  echo "→ arrêt du serveur (port $PORT) : $(echo "$SERVER_PIDS" | tr '\n' ' ')"
  kill $SERVER_PIDS 2>/dev/null
  sleep 1
  # Ceux qui résistent au SIGTERM
  STILL=$(lsof -ti tcp:"$PORT" 2>/dev/null || true)
  [ -n "$STILL" ] && kill -9 $STILL 2>/dev/null
else
  echo "→ aucun serveur sur le port $PORT"
fi

# 2. stripe listen ------------------------------------------------------------
# Motif tolérant aux flags insérés entre « listen » et « --forward-to »
# (ex. --skip-update), plutôt qu'une chaîne figée qui casse silencieusement
# au moindre changement d'invocation dans start-demo.sh.
LISTEN_PATTERN="stripe listen.*--forward-to localhost:$PORT/webhook"
if pgrep -f "$LISTEN_PATTERN" >/dev/null 2>&1; then
  echo "→ arrêt de « stripe listen »"
  pkill -f "$LISTEN_PATTERN" 2>/dev/null
else
  echo "→ « stripe listen » n'était pas lancé"
fi

# 3. Fermer les fenêtres Terminal ouvertes par start-demo.sh -----------------
if [ "$(uname)" = "Darwin" ] && osascript -e 'tell application "Terminal" to count windows' >/dev/null 2>&1; then
  osascript <<EOF
tell application "Terminal"
  repeat with w in (every window)
    try
      if (custom title of (tab 1 of w) starts with "$TAG_PREFIX") then
        close w saving no
      end if
    end try
  end repeat
end tell
EOF
  echo "→ fenêtres Terminal « $TAG_PREFIX » refermées"
fi

echo "──── Terminé ────"
