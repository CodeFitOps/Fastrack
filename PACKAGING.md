# Empaquetado

La app web ya está: `npm run build` produce un `dist/` que funciona sin conexión.
Los dos shells cargan ese mismo `dist/`. La app es idéntica en ambos; lo único
que cambia es la carcasa.

**Decisión tomada sobre macOS**: ventana estrecha (460px), redimensionable pero
con un máximo de 620. Las tres pantallas están diseñadas para una columna; una
barra semanal de siete días estirada a 1400px queda mal. Rediseñar History y
Stats para escritorio es un trabajo aparte que no bloquea esto.

---

## 1. Instalar dependencias

```bash
# Android
npm i @capacitor/core @capacitor/app @capacitor/preferences \
      @capacitor/local-notifications @capacitor/status-bar
npm i -D @capacitor/cli @capacitor/android

# macOS
npm i -D electron electron-builder @electron/notarize concurrently wait-on
```

`capacitor.config.json`, `electron/`, `electron-builder.json` y
`build/entitlements.mac.plist` ya están en el repositorio.

---

## 2. Android

```bash
npx cap add android
npm run android:sync
npm run android:open      # abre Android Studio
```

### Ediciones manuales que Capacitor no hace

**`android/app/src/main/AndroidManifest.xml`** — sin esto las notificaciones se
descartan en silencio en Android 13+ (API 33), que es la mayoría del parque:

```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>
<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM"/>
<uses-permission android:name="android.permission.USE_EXACT_ALARM"/>
```

`SCHEDULE_EXACT_ALARM` es lo que permite que la alerta de «ayuno completado»
salte a su hora en vez de cuando el sistema tenga a bien. Sin ella, Doze puede
retrasarla una hora larga — inútil para un aviso que existe precisamente para
avisar a tiempo.

> Google Play restringe `SCHEDULE_EXACT_ALARM`: hay que justificar su uso en el
> formulario de la ficha. Una alarma de ayuno es un caso aceptado, pero
> prepárate para explicarlo. `USE_EXACT_ALARM` no requiere justificación pero
> sólo vale para alarmas y recordatorios visibles al usuario, que es este caso.

**Icono de notificación**: Android exige un icono monocromo. Ponlo en
`android/app/src/main/res/drawable/ic_stat_fastrack.png` (blanco sobre
transparente). Si falta, la notificación sale con un cuadrado gris.

### Comprobaciones en dispositivo

Estas son las que no se pueden hacer en el navegador, y donde salen los fallos:

1. Empieza un ayuno, mata la app desde el selector, vuelve a abrirla — el reloj
   debe seguir donde toca.
2. Reinicia el teléfono con un ayuno activo. Igual.
3. Empieza un ayuno con objetivo a 2 minutos, bloquea el teléfono y espera. La
   notificación debe llegar con la pantalla apagada.
4. Botón atrás: con una hoja abierta la cierra; en Diario vuelve a Today; en
   Today minimiza. Nunca cierra la app de golpe.
5. Gira la pantalla y comprueba que nada queda bajo la barra de estado ni bajo
   la barra de gestos — Android 15 fuerza edge-to-edge.

---

## 3. macOS

```bash
npm run dev:electron      # desarrollo, con recarga en caliente
npm run build:mac         # produce release/Fastrack-0.1.0.dmg
```

### Firma y notarización

Sin esto, el `.dmg` sólo abre en tu Mac. En cualquier otro Gatekeeper lo bloquea
con «Apple no puede comprobar si contiene software malicioso», y un usuario
normal no sabe saltárselo.

Necesitas una cuenta de Apple Developer (99 $/año) y un certificado *Developer
ID Application* en el llavero. Luego:

```bash
export APPLE_ID="tu@correo.com"
export APPLE_APP_PASSWORD="xxxx-xxxx-xxxx-xxxx"   # específica de app
export APPLE_TEAM_ID="XXXXXXXXXX"
npm run build:mac
```

La contraseña específica de app se genera en appleid.apple.com → Seguridad. **No
es** la contraseña de tu Apple ID, y no debe ir al repositorio: `.gitignore` ya
excluye `.env`.

Si faltan las variables, el build sigue y sólo avisa — útil para probar en local.
La notarización tarda entre 5 y 15 minutos.

---

## 4. Lo que falta antes de publicar

- **Iconos**: `build/icon.icns` (macOS, 1024×1024) y los de Android vía Android
  Studio → Image Asset.
- **Fuentes**: los tres `.woff2` de Archivo en `public/fonts/`. Sin ellos la
  tipografía cae a system-ui y el diseño se desmonta.
- **Licencia**: el repositorio lleva la Unlicense (dominio público). Para algo
  que vas a publicar en tiendas, probablemente quieras MIT o propietaria —
  cambiarla después de aceptar contribuciones externas es un lío.
- **Keystore de Android** para firmar el release. Guárdalo fuera del repositorio
  y con copia de seguridad: si lo pierdes, no puedes volver a actualizar la app
  en Play, nunca.

---

## 5. Trabajar entre macOS y Ubuntu

| | Ubuntu | macOS |
|---|---|---|
| Tests y `dist/` | sí | sí |
| APK de Android | sí | sí |
| `.dmg` de macOS | **no** | sí |

Firmar y notarizar una app de macOS necesita `codesign` y `notarytool`, que sólo
existen en macOS. No hay forma de saltárselo desde Linux: no es una limitación
de Electron sino de Apple. Se puede *generar* un `.app` sin firmar con
`--publish never`, pero no abrirá en ningún otro Mac, así que no sirve para
distribuir.

El código no necesita ningún cambio entre plataformas: sólo cambia el toolchain.

**Recomendación**: Ubuntu como máquina de trabajo para Android y las pruebas de
beta, y `.github/workflows/build.yml` para el `.dmg`. Así el build de macOS no
depende de qué portátil tengas delante, y los dos artefactos salen del mismo
commit.

### Instalar el SDK de Android en Ubuntu

`ERR_SDK_NOT_FOUND` significa que falta el SDK. Sin Android Studio:

```bash
sudo apt install -y openjdk-21-jdk
mkdir -p ~/Android/cmdline-tools && cd ~/Android/cmdline-tools
# Descargar "Command line tools only" de developer.android.com/studio
unzip commandlinetools-linux-*.zip && mv cmdline-tools latest

export ANDROID_HOME=$HOME/Android
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools
sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"
```

Añade los `export` a `~/.bashrc` o `cap run` no encontrará el SDK en la próxima
sesión.

Para probar en un teléfono real: activa Opciones de desarrollador y depuración
USB, conéctalo, y `adb devices` debe listarlo. Es mejor banco de pruebas que un
emulador, porque los fallos de notificaciones y de suspensión sólo salen en
hardware.

### Beta testing

Para repartir un APK sin pasar por Play, la vía corta es subir el artefacto de
CI y compartir el enlace. Ojo: un APK de debug no se puede actualizar sobre uno
de release ni al revés — las firmas no coinciden y Android rechaza la
instalación. Elige una vía desde el principio.
