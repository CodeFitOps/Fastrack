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

## 3. Entornos

Cada entorno tiene su carpeta, su rama, su puerto, su base de datos y su
servicio. **Bases separadas es lo importante**: compartirlas haría que una
prueba en dev machacara los datos de stg.

| | dev | stg |
|---|---|---|
| Rama | `dev` | `main` |
| Carpeta | `~/LAB/fastrack/dev/Fastrack` | `~/LAB/fastrack/stg/Fastrack` |
| Puerto | 8788 | 8787 |
| Servicio | `fastrack-dev` | `fastrack-stg` |
| Base | `~/LAB/fastrack/dev/data/` | `~/LAB/fastrack/stg/data/` |
| Fuera | no (sólo local) | `fastrack.codeengtools.eu` |

La configuración va en un `.env` por entorno, **que no se versiona**. En el
repositorio queda `.env.example` documentando cada variable.

```bash
cd ~/LAB/fastrack/dev/Fastrack
git checkout dev
cp .env.example .env
$EDITOR .env                      # ENV_NAME=dev, PORT=8788, DB_PATH=…
bash scripts/setup-server.sh
```

El script comprueba Node, arranca el servidor contra una base temporal, hace un
ciclo de sincronización real, y genera `/tmp/fastrack-dev.service` con tus rutas
ya rellenadas.

```bash
cat /tmp/fastrack-dev.service     # revísalo primero
sudo cp /tmp/fastrack-dev.service /etc/systemd/system/fastrack-dev.service
sudo systemctl daemon-reload
sudo systemctl enable --now fastrack-dev
systemctl status fastrack-dev
```

Para stg, lo mismo desde su carpeta con su `.env`.

> La unidad apunta al `.env` con `EnvironmentFile=`, no copia sus valores.
> Cambiar el puerto o la base es editar el `.env` y reiniciar el servicio: no
> hace falta regenerar la unidad.
>
> Ojo con el formato: systemd lee ese fichero directamente y **no** es sintaxis
> de shell. Nada de `export`, ni `$VARIABLES`, ni comandos. Sólo `CLAVE=valor`.

### Probar dev desde el Mac

dev escucha sólo en local. Un túnel SSH basta y evita abrir puertos:

```bash
ssh -N -L 8788:127.0.0.1:8788 mpino@192.168.1.110
```

Y abres `http://localhost:8788` en el navegador.

### Desplegar un cambio

```bash
# dev
cd ~/LAB/fastrack/dev/Fastrack
git pull && npm run build:web && sudo systemctl restart fastrack-dev

# stg, cuando dev esté estable
cd ~/LAB/fastrack/stg/Fastrack
git checkout main && git merge dev && git push
npm run build:web && sudo systemctl restart fastrack-stg
```

**El `build:web` no es opcional**: la app se sirve compilada desde `dist/`, así
que un `git pull` sin recompilar deja la versión anterior en pantalla.

## 3b. Compilar la app

El servidor de sincronización sirve también la app compilada, desde el mismo
puerto. Es lo que hace que **no haya CORS**: app y API comparten origen, hace
falta un solo hostname en Cloudflare, y una sola política de Access protege
ambas cosas.

```bash
npm install          # ahora sí hacen falta las dependencias
npm run build:web    # genera dist/
sudo systemctl restart fastrack
```

Ahora `http://192.168.1.110:8787` sirve la app entera. **Ya no hace falta
`npm run dev`**, y conviene que no lo esté: el servidor de desarrollo de Vite
compila al vuelo, sirve los fuentes sin minimizar e incluye herramientas de
depuración. Nunca detrás de Cloudflare.

Cierra el puerto que ya no usas:

```bash
sudo ufw delete allow in on br0 from 192.168.1.0/24 to any port 5173 proto tcp
```

Tras cada `git pull` con cambios de interfaz hay que recompilar:

```bash
git pull && npm run build:web && sudo systemctl restart fastrack
```

> Si prefieres separar la app del servidor, `SERVE_APP=0` desactiva los
> estáticos y vuelve a hacer falta CORS y un segundo hostname.

## 4. Cloudflare

### El túnel

Zero Trust → Networks → Tunnels → tu túnel → **Public Hostname** → *Add*:

- Subdominio `fastrack`, tu dominio
- Tipo **HTTP**, URL `http://127.0.0.1:8787`

> **`127.0.0.1`, no `localhost`.** Si `cloudflared` resuelve `localhost` a IPv6
> y el servidor escucha en IPv4, obtienes un 502 sin ninguna pista de por qué.

Comprueba desde fuera de tu red — con los datos del móvil, no por wifi:

```
https://fastrack.TUDOMINIO.com/health
```

Si devuelve JSON, el túnel va **pero Access todavía no está y tus datos están
abiertos a internet**. Ponle la política antes de seguir.

### La política de Access

Zero Trust → Access → Applications → *Add an application* → **Self-hosted**:

- Dominio: `fastrack.TUDOMINIO.com`
- Política: *Allow*, regla **Emails** → tu correo

Vuelve a abrir `/health`: ahora debe salir la pantalla de login. Entra, y luego:

```
https://fastrack.TUDOMINIO.com/whoami
```

Debe devolver tu email y `viaAccess: true`. Si dice `local`, la cabecera de
identidad no está llegando y no conviene seguir.

### Mover tus datos al nuevo usuario

Hasta ahora todo se guardó bajo `local`, porque no había identidad. En cuanto
Access funciona, el servidor te busca por tu email y **la app aparece vacía** —
los datos están, en otro cajón.

```bash
cp ~/fastrack.db ~/fastrack.db.bak
node scripts/migrate-user.mjs local tu@correo.com            # vista previa
node scripts/migrate-user.mjs local tu@correo.com --apply
sudo systemctl restart fastrack
```

Sin `--apply` sólo enseña lo que haría.

### Cerrar la puerta de atrás

Mientras probábamos en la LAN, el servidor quedó escuchando en todas las
interfaces. Ahora sobra, y es lo único que permitiría llegar **saltándose
Access**:

```bash
sudo systemctl edit --full fastrack     # borra la línea Environment=HOST=0.0.0.0
sudo ufw delete allow in on br0 from 192.168.1.0/24 to any port 8787 proto tcp
sudo systemctl restart fastrack
journalctl -u fastrack -n 5 --no-pager  # debe decir 127.0.0.1, sin el AVISO
```

A partir de aquí sólo se entra por el túnel, y el túnel exige identificarse.

### Multiusuario

Ya funciona: el servidor separa los datos por el email del JWT de Access, así
que añadir a alguien es añadir su correo a la política. Cada uno ve sólo lo
suyo, sin tocar código.

Lo que **no** hay es nada compartido entre usuarios — ni ver los ayunos de otro,
ni datos comunes. Si algún día hiciera falta, es trabajo aparte.

### El móvil: service token

El login interactivo de Access no funciona bien dentro de un WebView: varios
proveedores de identidad bloquean OAuth en webviews embebidos. Sólo hace falta
para el APK; en el navegador del móvil el login normal funciona.

1. Zero Trust → Access → **Service Auth** → *Create Service Token*. Guarda el
   Client ID y el Secret; el secreto se enseña una sola vez.
2. En la política de la aplicación, añade una regla *Service Auth* → **Service
   Token** → el que acabas de crear.
3. El APK manda `CF-Access-Client-Id` y `CF-Access-Client-Secret`.

**Sabiendo que** ese secreto viaja dentro del APK, y un APK se descompila. Para
uso personal es asumible; si repartes la app, no lo es.

> Un service token no lleva email, así que sus peticiones caerán en el usuario
> por defecto. Para que el móvil vea tus datos, arranca el servicio con
> `Environment=DEFAULT_USER=tu@correo.com`.

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

## Reiniciar en pruebas

```bash
node scripts/reset-server.mjs                          # lista lo que hay
node scripts/reset-server.mjs --user tu@correo --yes   # borra un usuario
node scripts/reset-server.mjs --all --yes              # borra todo
```

Sin `--yes` sólo enseña lo que haría.

**Borrar el servidor no basta.** Cada dispositivo conserva su copia, y como el
borrado no deja lápidas, el primero que sincronice repoblará la base entera. Hay
que borrar también en cada uno, con el botón **BORRAR ESTE DISPOSITIVO** de la
hoja de copia de seguridad, o desde la consola del navegador:

```js
Object.keys(localStorage).filter(k => k.startsWith('fastrack.'))
  .forEach(k => localStorage.removeItem(k)); location.reload()
```

El botón de la app es mejor que la consola porque conserva la dirección del
servidor y la identidad del dispositivo: vuelve a sincronizar solo, sin
reconfigurar nada.

Al borrar un usuario se libera también su dispositivo principal, así que el
siguiente que sincronice tomará el papel, como en una instalación nueva.

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
