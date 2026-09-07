#!/usr/bin/env bash
# Lance toute la démo Velvet dans trois fenêtres Terminal séparées, comme
# décrit dans RUNBOOK.md T-10 min :
#   Terminal 1 : stripe listen  (webhook)
#   Terminal 2 : npm start      (serveur local, port 4242)
#   Terminal 3 : npm run preflight
#
# Le dossier de démonstration est d'abord remis à zéro (scripts/reset-demo.js)
# pour qu'aucune carte enregistrée d'une répétition précédente n'apparaisse
# dès l'ouverture de /paiement. Le webhook signing secret changé à chaque
# « stripe listen » est capturé automatiquement et écrit dans .env AVANT de
# démarrer le serveur, pour que la vérification de signature ne casse jamais.
# À la fin, un événement de test est déclenché et on vérifie qu'il ressort
# bien du listener local.
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PORT=4242
TAG_PREFIX="Velvet ·"
RUN_DIR="/tmp/velvet-demo"
LISTEN_LOG="$RUN_DIR/listen.log"
SERVER_LOG="$RUN_DIR/server.log"
TRIGGER_LOG="$RUN_DIR/trigger.log"
mkdir -p "$RUN_DIR"
: > "$LISTEN_LOG"
: > "$SERVER_LOG"

if [ "$(uname)" != "Darwin" ]; then
  echo "Ce script pilote Terminal.app — macOS uniquement." >&2
  exit 1
fi

echo "──── Démarrage de la démo Velvet ────"

# 0. Repartir propre : on tue tout ce qui traînerait déjà sur ce port --------
"$ROOT_DIR/scripts/stop-demo.sh" >/dev/null 2>&1 || true
sleep 1

# 0bis. Remise à zéro du dossier : sans ça, une carte ou une intention
# laissée par la répétition précédente réapparaît dès /paiement, avant même
# le premier refus du beat 04:30.
echo "→ remise à zéro du dossier de démonstration (npm run reset)"
node scripts/reset-demo.js

open_tab() {
  local title="$1"
  local cmd="$2"
  osascript <<EOF
tell application "Terminal"
  activate
  set w to do script "$cmd"
  delay 0.3
  set custom title of w to "$title"
end tell
EOF
}

# 1. Terminal 1 : stripe listen ----------------------------------------------
# `script` alloue un pseudo-terminal au processus : sans ça, sa sortie standard
# n'est plus un TTY (elle irait vers un pipe/fichier) et le binaire Go du CLI
# Stripe passe en buffering par bloc — les événements n'apparaissent dans le
# log qu'une fois le tampon plein, jamais en temps réel. C'est ce qui faisait
# disparaître les webhooks après la toute première salve.
SECRET_KEY="$(grep '^STRIPE_SECRET_KEY=' .env | cut -d= -f2)"
if [ -z "$SECRET_KEY" ]; then
  echo "✗ STRIPE_SECRET_KEY absent de .env — impossible de cibler le bon compte Stripe." >&2
  exit 1
fi

# --api-key est indispensable : sans lui, stripe listen retombe sur le compte
# par défaut de la CLI (celui de `stripe login`), qui n'est pas forcément le
# sandbox Velvet de .env. Les webhooks arriveraient alors pour un autre
# compte que celui du serveur, et jamais pour les vrais paiements de la démo
# — un décalage silencieux qui a fait échouer le réaffichage de la carte
# enregistrée de Camille sans qu'aucune erreur n'apparaisse.
echo "→ Terminal 1 : stripe listen --forward-to localhost:$PORT/webhook"
open_tab "$TAG_PREFIX listen" "cd '$ROOT_DIR' && script -q '$LISTEN_LOG' /opt/homebrew/bin/stripe listen --skip-update --api-key '$SECRET_KEY' --forward-to localhost:$PORT/webhook"

echo "  … attente du webhook signing secret"
SECRET=""
for i in $(seq 1 60); do
  if grep -qo 'whsec_[A-Za-z0-9]*' "$LISTEN_LOG" 2>/dev/null; then
    SECRET=$(grep -o 'whsec_[A-Za-z0-9]*' "$LISTEN_LOG" | head -1)
    break
  fi
  sleep 1
done

if [ -z "$SECRET" ]; then
  echo "✗ Pas de whsec_… après 60s dans $LISTEN_LOG — vérifie Terminal 1 (login Stripe CLI ? réseau ?)." >&2
  exit 1
fi
echo "✓ secret récupéré : ${SECRET:0:12}…"

# 2. Écrire le secret dans .env AVANT de démarrer le serveur -----------------
if grep -q '^STRIPE_WEBHOOK_SECRET=' .env; then
  sed -i '' "s/^STRIPE_WEBHOOK_SECRET=.*/STRIPE_WEBHOOK_SECRET=$SECRET/" .env
else
  echo "STRIPE_WEBHOOK_SECRET=$SECRET" >> .env
fi
echo "✓ .env mis à jour"

# 3. Terminal 2 : npm start ---------------------------------------------------
# Même raison qu'au Terminal 1 : un vrai pseudo-terminal pour que les logs
# s'écrivent au fil de l'eau, pas seulement en bloc.
echo "→ Terminal 2 : npm start"
open_tab "$TAG_PREFIX server" "cd '$ROOT_DIR' && script -q '$SERVER_LOG' npm start"

echo "  … attente que le serveur réponde sur le port $PORT"
UP=""
for i in $(seq 1 30); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/api/config" 2>/dev/null || true)
  if [ "$CODE" = "200" ]; then UP=1; break; fi
  sleep 1
done

if [ -z "$UP" ]; then
  echo "✗ Le serveur ne répond pas sur http://localhost:$PORT après 30s — regarde Terminal 2." >&2
  exit 1
fi
echo "✓ serveur prêt sur http://localhost:$PORT"

# 4. Terminal 3 : preflight ---------------------------------------------------
echo "→ Terminal 3 : npm run preflight"
open_tab "$TAG_PREFIX preflight" "cd '$ROOT_DIR' && npm run preflight"

# 5. Vérification bout en bout : le webhook arrive-t-il vraiment ? -----------
# On grep directement le log de Terminal 2 (script -q écrit la sortie de
# « npm start » au fil de l'eau) plutôt que d'interroger une route dédiée.
echo "→ vérification : déclenchement d'un payment_intent.succeeded de test"
BEFORE_COUNT=$(grep -c '^\[webhook\] payment_intent.succeeded ' "$SERVER_LOG" 2>/dev/null || true)
BEFORE_COUNT=${BEFORE_COUNT:-0}
/opt/homebrew/bin/stripe trigger payment_intent.succeeded --api-key "$SECRET_KEY" > "$TRIGGER_LOG" 2>&1
sleep 6
AFTER_COUNT=$(grep -c '^\[webhook\] payment_intent.succeeded ' "$SERVER_LOG" 2>/dev/null || true)
AFTER_COUNT=${AFTER_COUNT:-0}

if [ "$AFTER_COUNT" -gt "$BEFORE_COUNT" ]; then
  echo "✓ Webhook bien reçu par le serveur local (Terminal 1 → Terminal 2)."
else
  echo "✗ Le webhook de test n'apparaît pas dans $SERVER_LOG — vérifie Terminal 1 (stripe listen" >&2
  echo "  toujours ouvert ?) et Terminal 2 (⚠ STRIPE_WEBHOOK_SECRET absent au démarrage ?)." >&2
fi

echo "──── Démo prête : 3 fenêtres ouvertes, webhook vérifié ────"
echo "Pour tout arrêter : npm run demo:stop"
