#!/usr/bin/env bash
#
# Preparación del servidor de sincronización.
#
# Comprueba requisitos, arranca el servidor de prueba contra una base temporal y
# verifica que responde. Genera el fichero de systemd, pero NO lo instala: eso
# necesita sudo, y un script que escribe en /etc sin que lo veas es exactamente
# lo que no hay que ejecutar a ciegas. Te enseña el comando y lo ejecutas tú.
#
#   bash scripts/setup-server.sh
#
set -euo pipefail

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; DIM=$'\033[2m'; OFF=$'\033[0m'
ok()   { echo "${GREEN}✓${OFF} $1"; }
bad()  { echo "${RED}✗${OFF} $1"; }
warn() { echo "${YELLOW}!${OFF} $1"; }

echo
echo "Fastrack — preparación del servidor"
echo "───────────────────────────────────"

# ── Node ───────────────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  bad "Node no está instalado."
  echo
  echo "  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
  echo "  sudo apt install -y nodejs"
  exit 1
fi

NODE_VERSION=$(node -v)
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
NODE_MINOR=$(node -p "process.versions.node.split('.')[1]")

if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 5 ]; }; then
  bad "Node $NODE_VERSION — hace falta 22.5 o superior."
  echo
  echo "  node:sqlite, que usa el servidor, no existe en tu versión."
  echo "  Vite 7 tampoco funciona por debajo de la 20.19."
  echo
  echo "  ${DIM}Opción A — Node del sistema (recomendado en un servidor):${OFF}"
  echo "    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
  echo "    sudo apt install -y nodejs"
  echo
  echo "  ${DIM}Opción B — nvm, sin tocar el Node del sistema:${OFF}"
  echo "    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
  echo "    nvm install 22 && nvm use 22"
  echo
  warn "Con nvm, systemd NO encontrará node: hay que poner la ruta completa"
  warn "en ExecStart. La da 'which node' con la versión ya activa."
  exit 1
fi
ok "Node $NODE_VERSION"

# ── node:sqlite ────────────────────────────────────────────────────────
if node -e "require('node:sqlite')" 2>/dev/null; then
  ok "node:sqlite disponible"
else
  bad "node:sqlite no disponible pese a la versión. ¿Node compilado sin SQLite?"
  exit 1
fi

# ── Tests ──────────────────────────────────────────────────────────────
if [ -d node_modules ]; then
  echo "${DIM}Ejecutando los tests…${OFF}"
  if npm test >/dev/null 2>&1; then
    ok "tests en verde"
  else
    bad "los tests fallan — revísalo antes de desplegar (npm test)"
    exit 1
  fi
else
  warn "sin node_modules; los tests del núcleo no necesitan dependencias,"
  warn "pero para compilar la web hará falta 'npm install'."
fi

# ── Prueba en vivo ─────────────────────────────────────────────────────
PORT=${PORT:-8787}
TMPDB=$(mktemp -d)/probe.db
echo "${DIM}Arrancando el servidor en el puerto $PORT contra una base temporal…${OFF}"

DB_PATH="$TMPDB" PORT="$PORT" node server/server.js >/tmp/fastrack-probe.log 2>&1 &
SERVER_PID=$!
# Se para pase lo que pase, incluso si el script falla más abajo.
trap 'kill $SERVER_PID 2>/dev/null || true; rm -rf "$(dirname "$TMPDB")"' EXIT

for _ in $(seq 1 20); do
  sleep 0.25
  if curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then break; fi
done

if ! curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
  bad "el servidor no responde. Registro:"
  cat /tmp/fastrack-probe.log
  exit 1
fi
ok "responde en /health"

# Un ciclo real de sincronización: subir un registro y recuperarlo.
RESPONSE=$(curl -sf -X POST "http://127.0.0.1:$PORT/sync" \
  -H 'content-type: application/json' \
  -d '{"since":0,"events":[{"id":"probe","at":1,"kind":"note","updatedAt":1}]}')

if echo "$RESPONSE" | grep -q '"probe"'; then
  ok "un ciclo de sincronización funciona"
else
  bad "la sincronización no devolvió lo esperado: $RESPONSE"
  exit 1
fi

# ── systemd ────────────────────────────────────────────────────────────
UNIT=/tmp/fastrack.service
NODE_BIN=$(command -v node)
# $USER no existe en shells no interactivos (cron, sudo -u, CI). `id -un`
# siempre funciona.
RUN_USER=$(id -un)
RUN_HOME=${HOME:-$(getent passwd "$RUN_USER" | cut -d: -f6)}
cat > "$UNIT" <<EOF
[Unit]
Description=Fastrack sync
After=network.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$PWD
Environment=DB_PATH=$RUN_HOME/fastrack.db
Environment=PORT=$PORT
Environment=NODE_ENV=production
ExecStart=$NODE_BIN server/server.js
Restart=always
RestartSec=5

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$RUN_HOME

[Install]
WantedBy=multi-user.target
EOF

echo
ok "todo listo"
echo
echo "Fichero de systemd generado en ${DIM}$UNIT${OFF} con tus rutas."
echo "Revísalo y, si te parece bien:"
echo
echo "  sudo cp $UNIT /etc/systemd/system/fastrack.service"
echo "  sudo systemctl daemon-reload"
echo "  sudo systemctl enable --now fastrack"
echo "  systemctl status fastrack"
echo
echo "Después, el túnel de Cloudflare apuntando a localhost:$PORT."
echo "Los pasos están en DEPLOY.md."
echo
