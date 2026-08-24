# Despliegue — Ubuntu + Cloudflare

Arquitectura: **local-first con sincronización**. Cada dispositivo es completo y
autónomo; el servidor replica. El móvil sigue funcionando sin red.

El servidor no tiene dependencias: usa `node:sqlite` y `node:http`, ambos
incluidos en Node. Nada que instalar, nada que auditar.

> **Antes de empezar**: el servidor **no tiene autenticación propia**. Depende
> por completo de que Cloudflare Access esté delante. Escucha sólo en `127.0.0.1`
> por eso mismo. No lo pongas a escuchar en `0.0.0.0` ni le abras un puerto en el
> router: sería publicar tus datos de salud sin ninguna barrera.

---

## 1. Subir el código

```bash
npm test                        # 146, en verde antes de nada
git add -A
git commit -m "Add sync server, sync client and device roles"
git push
```

## 2. En el Ubuntu

```bash
git clone https://github.com/CodeFitOps/Fastrack.git
cd Fastrack
node -v                         # necesita 22 o superior para node:sqlite
```

Prueba que arranca:

```bash
DB_PATH=$HOME/fastrack.db node server/server.js
```

Debe decir `Fastrack sync escuchando en http://127.0.0.1:8787`. En otra terminal:

```bash
curl localhost:8787/health      # {"ok":true,...}
```

Para el proceso con Ctrl-C.

## 3. Servicio systemd

Para que sobreviva a reinicios y cierres de sesión:

```bash
sudo tee /etc/systemd/system/fastrack.service > /dev/null <<'EOF'
[Unit]
Description=Fastrack sync
After=network.target

[Service]
Type=simple
User=TU_USUARIO
WorkingDirectory=/home/TU_USUARIO/Fastrack
Environment=DB_PATH=/home/TU_USUARIO/fastrack.db
Environment=PORT=8787
ExecStart=/usr/bin/node server/server.js
Restart=always
RestartSec=5

# Endurecido: el proceso no necesita nada del sistema salvo su base de datos.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/home/TU_USUARIO/fastrack.db

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now fastrack
systemctl status fastrack
```

Sustituye `TU_USUARIO` en los cuatro sitios.

## 4. Cloudflare

Ya tienes túnel, así que es añadir un *public hostname* al que existe:

1. Zero Trust → Networks → Tunnels → tu túnel → **Public Hostname** → *Add*.
2. Subdominio `fastrack`, tu dominio, tipo **HTTP**, URL `localhost:8787`.

Comprueba desde fuera:

```bash
curl https://fastrack.TUDOMINIO.com/health
```

### La política de Access

Zero Trust → Access → Applications → *Add an application* → **Self-hosted**:

- Dominio: `fastrack.TUDOMINIO.com`
- Política: *Allow*, regla **Emails** → tu correo

Vuelve a hacer el `curl` de antes: ahora debe devolver HTML de login en vez de
JSON. Eso confirma que Access está protegiendo el endpoint.

> Fíjate en que devuelve **HTML con estado 200**, no un 401. Es exactamente la
> trampa que `syncClient.js` detecta: sin esa comprobación, el cliente parsearía
> la página de login como si fueran datos.

### El móvil: service token

El login interactivo de Access no funciona bien dentro de un WebView — varios
proveedores de identidad bloquean OAuth en webviews embebidos. Para el APK:

1. Zero Trust → Access → **Service Auth** → *Create Service Token*. Guarda el
   Client ID y el Client Secret; el secreto sólo se enseña una vez.
2. En la política de la aplicación añade una regla *Service Auth* → **Service
   Token** → el que acabas de crear.
3. El APK manda las cabeceras `CF-Access-Client-Id` y `CF-Access-Client-Secret`.

**Sabiendo que**: ese secreto viaja dentro del APK y un APK se puede
descompilar. Para uso personal es asumible; si algún día repartes la app, no lo
es, y habría que pasar al navegador del sistema para el login.

## 5. Configurar los dispositivos

En cada uno, ajustes de sincronización:

| | Portátil | Móvil |
|---|---|---|
| URL | `https://fastrack.TUDOMINIO.com` | igual |
| Papel | Secundario | **Principal** |

El papel se guarda **local y no se sincroniza**: es una propiedad del
dispositivo. Si viajara con los datos, ambos acabarían igual y ninguno podría
llevar el ayuno.

Sólo el principal empieza, termina y corrige ayunos. Los dos registran comidas,
cetonas, entrenos y notas.

## 6. Comprobar que va

1. Registra una comida en el portátil.
2. Espera medio minuto o vuelve a la app en el móvil.
3. Debe aparecer allí.
4. Bórrala en el móvil. Debe desaparecer del portátil **y no volver** — eso es
   lo que verifican las lápidas.
5. Pon el móvil en modo avión, empieza un ayuno, registra algo, quita el modo
   avión. Debe subir solo.

## Mantenimiento

```bash
journalctl -u fastrack -f                          # registro en vivo
sudo systemctl restart fastrack                    # tras un git pull
cp ~/fastrack.db ~/fastrack-$(date +%F).db         # copia
```

La base es un solo fichero: copiarlo es la copia de seguridad completa.
Merece la pena un cron semanal, porque ahora tus datos viven en dos sitios y
sólo uno de ellos está en un disco que controlas.

## Lo que queda pendiente

- **Empuje en vivo (SSE)**: ahora sincroniza cada 30 s. Para «en vivo» de
  verdad, el servidor empuja y el cliente sólo envía por POST. Menos piezas que
  un WebSocket.
- **Compresión del historial**: cada ciclo manda lo cambiado desde la marca de
  agua, así que el tamaño no crece con el historial. Pero la primera
  sincronización de un dispositivo nuevo manda todo; con años de datos convendrá
  paginarla.
