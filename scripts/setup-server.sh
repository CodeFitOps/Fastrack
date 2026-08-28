#!/usr/bin/env bash
#
# Preparación de un entorno de Fastrack.
#
# Lee la configuración de .env (o del fichero que se pase), comprueba
# requisitos, arranca el servidor contra una base temporal, verifica que un
# ciclo de sincronización funciona, y genera la unidad de systemd del entorno.
#
#   cp .env.example .env      # y ajústalo
#   bash scripts/setup-server.sh
#   bash scripts/setup-server.sh .env.stg
#
# NO instala nada por su cuenta: escribir en /etc necesita sudo, y un script que
# lo hace sin que lo veas es justo lo que no conviene ejecutar a ciegas. Enseña
# el comando y lo lanzas tú.
#
set -euo pipefail

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; DIM=$'\033[2m'; OFF=$'\033[0m'
ok()   { echo "${GREEN}✓${OFF} $1"; }
bad()  { echo "${RED}✗${OFF} $1"; }
warn() { echo "${YELLOW}!${OFF} $1"; }

ENV_FILE=${1:-.env}

echo
echo "Fastrack — preparación del entorno"
echo "──────────────────────────────────"

# ── Configuración ──────────────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  bad "No existe $ENV_FILE"
  echo
  echo "  cp .env.example $ENV_FILE"
  echo "  \$EDITOR $ENV_FILE"
  echo
  echo "  ${DIM}Cada entorno necesita su propio puerto y su propia base de datos.${OFF}"
  exit 1
fi

# `set -a` exporta lo que se defina a continuación, para que el servidor de
# prueba lo herede sin repetirlo variable a variable.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

ENV_NAME=${ENV_NAME:-dev}
PORT=${PORT:-8787}
HOST=${HOST:-127.0.0.1}
SERVICE="fastrack-${ENV_NAME}"

if [ -z "${DB_PATH:-}" ]; then
  bad "Falta DB_PATH en $ENV_FILE"
  exit 1
fi

ok "entorno: ${ENV_NAME}  ·  puerto ${PORT}  ·  servicio ${SERVICE}"
echo "  ${DIM}base de datos: ${DB_PATH}${OFF}"

# Aviso, no error: es legítimo en pruebas, pero conviene verlo escrito.
if [ "$HOST" = "0.0.0.0" ]; then
  warn "HOST=0.0.0.0 abre el puerto a la red local."
  warn "El servidor NO tiene autenticación propia: cualquier aparato entraría."
fi

mkdir -p "$(dirname "$DB_PATH")"

# ── Node ───────────────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  bad "Node no está instalado."
  echo "  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
  echo "  sudo apt install -y nodejs"
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
NODE_MINOR=$(node -p "process.versions.node.split('.')[1]")
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 5 ]; }; then
  bad "Node $(node -v) — hace falta 22.5 o superior (node:sqlite)."
  echo "  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
  echo "  sudo apt install -y nodejs"
  exit 1
fi
ok "Node $(node -v)"

if node -e "require('node:sqlite')" 2>/dev/null; then
  ok "node:sqlite disponible"
else
  bad "node:sqlite no disponible. ¿Node compilado sin SQLite?"
  exit 1
fi

# ── Tests ──────────────────────────────────────────────────────────────
if [ -d node_modules ]; then
  echo "${DIM}Ejecutando los tests…${OFF}"
  if npm test >/dev/null 2>&1; then
    ok "tests en verde"
  else
    bad "los tests fallan — revísalo con 'npm test' antes de desplegar"
    exit 1
  fi
else
  warn "sin node_modules; los tests del núcleo no los necesitan, pero"
  warn "'npm install' hace falta para compilar la app."
fi

# ── Prueba en vivo ─────────────────────────────────────────────────────
# Contra una base temporal, nunca contra la real: no debe tocar datos.
PROBE_DIR=$(mktemp -d)
PROBE_PORT=$((PORT + 1000))
echo "${DIM}Arrancando en el puerto ${PROBE_PORT} contra una base temporal…${OFF}"

DB_PATH="$PROBE_DIR/probe.db" PORT="$PROBE_PORT" HOST=127.0.0.1 \
  node server/server.js > "$PROBE_DIR/log" 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true; rm -rf "$PROBE_DIR"' EXIT

for _ in $(seq 1 20); do
  sleep 0.25
  if curl -sf "http://127.0.0.1:$PROBE_PORT/health" >/dev/null 2>&1; then break; fi
done

if ! curl -sf "http://127.0.0.1:$PROBE_PORT/health" >/dev/null 2>&1; then
  bad "el servidor no responde. Registro:"
  cat "$PROBE_DIR/log"
  exit 1
fi
ok "responde en /health"

RESPONSE=$(curl -sf -X POST "http://127.0.0.1:$PROBE_PORT/sync" \
  -H 'content-type: application/json' \
  -d '{"sinceSeq":0,"deviceId":"probe","events":[{"id":"probe","at":1,"kind":"note","updatedAt":1}]}')

if echo "$RESPONSE" | grep -q '"probe"'; then
  ok "un ciclo de sincronización funciona"
else
  bad "la sincronización no devolvió lo esperado: $RESPONSE"
  exit 1
fi

# ── systemd ────────────────────────────────────────────────────────────
UNIT="/tmp/${SERVICE}.service"
NODE_BIN=$(command -v node)
# $USER no existe en shells no interactivos; `id -un` sí.
RUN_USER=$(id -un)
DB_DIR=$(dirname "$DB_PATH")

cat > "$UNIT" <<EOF
[Unit]
Description=Fastrack sync (${ENV_NAME})
After=network.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${PWD}
# La configuración se lee del .env, no se copia aquí: cambiarla no obliga a
# regenerar la unidad, sólo a reiniciar el servicio.
EnvironmentFile=${PWD}/${ENV_FILE}
ExecStart=${NODE_BIN} server/server.js
Restart=always
RestartSec=5

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=${DB_DIR}

[Install]
WantedBy=multi-user.target
EOF

echo
ok "todo listo"
echo
echo "Unidad generada en ${DIM}${UNIT}${OFF}. Revísala y luego:"
echo
echo "  sudo cp ${UNIT} /etc/systemd/system/${SERVICE}.service"
echo "  sudo systemctl daemon-reload"
echo "  sudo systemctl enable --now ${SERVICE}"
echo "  systemctl status ${SERVICE}"
echo
echo "Compila la app y reinicia:"
echo "  npm install && npm run build:web && sudo systemctl restart ${SERVICE}"
echo
echo "Comprueba:  curl -s http://127.0.0.1:${PORT}/health"
echo
