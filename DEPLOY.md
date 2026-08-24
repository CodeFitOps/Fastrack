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

## 2. Node 22.5 o superior

Ubuntu 24 viene con Node 18, que **no sirve**: `node:sqlite` llegó en la 22.5, y
Vite 7 no funciona por debajo de la 20.19.

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v                         # v22.x
```

Si prefieres no tocar el Node del sistema, nvm también vale:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install 22 && nvm use 22
```

> Con nvm, **systemd no encontrará `node`**: el servicio no carga tu perfil de
> shell. Hay que poner la ruta completa en `ExecStart`, la que devuelva
> `which node` con la versión ya activa. El script de preparación lo hace solo.

## 3. Preparar el servidor

```bash
git clone https://github.com/CodeFitOps/Fastrack.git
cd Fastrack
npm run setup
```

El script comprueba la versión de Node, arranca el servidor contra una base
temporal, hace un ciclo de sincronización real para confirmar que funciona, y
genera el fichero de systemd con tus rutas ya rellenadas.

**No instala nada por su cuenta**: escribir en `/etc` requiere sudo, y un script
que lo hace sin que lo veas es justo lo que no conviene ejecutar a ciegas. Te
enseña el comando y lo lanzas tú:

```bash
cat /tmp/fastrack.service                 # revísalo primero
sudo cp /tmp/fastrack.service /etc/systemd/system/fastrack.service
sudo systemctl daemon-reload
sudo systemctl enable --now fastrack
systemctl status fastrack
```

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

### CORS

La app y el servidor están en puertos distintos durante el desarrollo (5173 y
8787), lo que para el navegador son orígenes distintos. El servidor refleja
automáticamente los orígenes locales — `localhost`, `127.0.0.1` y los rangos
privados `192.168.x.x`, `10.x.x.x`, `172.16-31.x.x` — así que en la LAN no hay
que configurar nada.

**Con Cloudflare sí**, porque tu dominio no es una dirección privada:

```
Environment=ALLOWED_ORIGINS=https://fastrack.TUDOMINIO.com
```

en la unidad de systemd, y `sudo systemctl restart fastrack`.

Sólo se reflejan orígenes conocidos, nunca cualquiera: como la app manda las
cookies de Access con `credentials: 'include'`, responder `*` está prohibido por
el propio navegador, y reflejar cualquier origen dejaría que otra web abierta en
tu navegador hablara con el servidor.

> Síntoma típico: `curl` funciona pero la app dice que no llega. `curl` no
> aplica la política de orígenes del navegador; si uno va y el otro no, es CORS.

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
