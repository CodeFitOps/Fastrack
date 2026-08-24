# Sincronización — diseño

Estado: **modelo de datos hecho, transporte por construir.**

## Forma elegida: local-first con sincronización

El dispositivo es autónomo y el servidor replica. La app funciona entera sin
red; cuando hay conexión, los dispositivos convergen.

La alternativa —servidor como única verdad— se descartó por un motivo concreto:
sin red no podrías empezar ni parar un ayuno. Parar un ayuno pasa cuando te
sientas a comer, que puede ser fuera de casa o sin cobertura. Es justo la acción
que no debe fallar nunca.

### Lo que ya sale gratis

El reloj no necesita sincronizarse. Ambos dispositivos derivan el tiempo
transcurrido de `startedAt`, así que si los dos conocen ese timestamp muestran
lo mismo sin hablar entre ellos. Lo único que viaja son eventos e inicios/fines
de ayuno: un puñado de registros al día, no un flujo continuo.

## Lo construido (esquema 3)

`src/core/sync.js` — 17 tests.

- `updatedAt` en cada registro: permite ordenar escrituras entre dispositivos.
- **Lápidas**: borrar marca `deletedAt`, no quita la fila. Sin esto, el otro
  dispositivo reenvía lo borrado y reaparece. Hay un test que documenta el
  fallo explícitamente, por si alguien "simplifica" quitándolas.
- `mergeRecords()` es **simétrica**: mismo resultado en cliente y servidor.
- `changedSince()` / `highWaterMark()`: qué enviar y hasta dónde se ha visto.
- `purgeTombstones()`: 90 días, holgado frente a lo que un móvil tarda en
  sincronizar. Purgar antes de que el otro lado haya visto la lápida la
  resucita.

### Resolución de conflictos, y su límite

Gana la escritura más reciente. Suficiente para un usuario con dos dispositivos:
editar el mismo registro a la vez en ambos es rarísimo. Un borrado empata a
favor del borrado, porque es más recuperable que algo borrado reaparezca a que
reaparezca lo que se quiso quitar.

**Su límite conocido**: depende del reloj de cada dispositivo. Si uno va cinco
minutos adelantado, sus escrituras ganan aunque sean anteriores en la práctica.
Si algún día molesta, la salida es un contador lógico (Lamport) en lugar de la
hora de pared — y ese cambio cabe después, porque no altera la forma de los
registros.

## Autenticación: Cloudflare Access

Delegada al túnel que ya existe. La app no gestiona usuarios.

**Dos aristas del transporte, para cuando se construya:**

1. **Access responde 302, no 401.** Al caducar la sesión, la petición recibe un
   redirect a la página de login. Un cliente ingenuo parsea ese HTML como JSON y
   falla de formas raras. Hay que detectarlo y tratarlo como «no autenticado,
   sigo encolando en local».

2. **El login interactivo no funciona bien en un WebView.** Varios proveedores
   de identidad bloquean OAuth en webviews embebidos. Las salidas son un
   *service token* (`CF-Access-Client-Id` / `CF-Access-Client-Secret`) o abrir
   el navegador del sistema. El service token es lo simple, sabiendo que va
   dentro del APK y un APK se descompila — asumible para uso personal.

**Costura barata ahora, cara después**: guardar los datos con un `userId`
derivado del email del JWT de Access (`Cf-Access-Jwt-Assertion`), aunque de
momento el usuario sea uno solo. Evita una migración si algún día se suma
alguien.

## Papeles: quién escribe qué

Decidido: **sólo el móvil empieza y termina ayunos**. El portátil consulta,
registra eventos y edita.

La distinción real no es «quién puede escribir» sino «qué pasa si escriben los
dos»:

| | Escritores | Si escriben ambos | Solución |
|---|---|---|---|
| Ciclo de vida del ayuno (empezar, terminar) | sólo el principal | estados incompatibles | se restringe |
| Campos de un ayuno existente (hora de inicio) | ambos | dos versiones del mismo registro | gana la más reciente |
| Eventos | ambos | ids distintos, sin colisión | se fusionan |

Por eso el portátil **no** puede empezar un ayuno pero **sí** corregirle la hora
de inicio — que es justo el tipo de tarea fina para la que un teclado va mejor
que un móvil. Restringir el ciclo de vida evita el conflicto en vez de
resolverlo, que siempre es preferible.

`src/core/roles.js` — 6 tests.

**Sin sincronización no hay papeles**: un dispositivo aislado es el único que
hay y puede hacerlo todo. Es el estado actual de la app y no cambia. El papel
sólo entra en juego con un servidor de por medio.

El papel se guarda **local y no se sincroniza**: es una propiedad del
dispositivo, no del usuario. Si viajara con los datos, ambos acabarían con el
mismo papel y uno quedaría sin poder llevar el ayuno.

### Consecuencia para las notificaciones

Si el portátil corrige la hora de inicio, el móvil debe **reprogramar su
notificación** al recibir el cambio. Ya existe esa lógica en `changeStart()`;
al construir el cliente de sincronización hay que llamarla también cuando el
cambio llega de fuera, no sólo cuando lo hace el usuario en el propio
dispositivo.

## Lo que falta

1. Endpoint `POST /sync`: recibe `{ since, records }`, devuelve lo que cambió
   desde `since` más el resultado de fusionar. La lógica de fusión ya está y es
   la misma en los dos lados.
2. Cola local de cambios pendientes, para cuando no hay red.
3. Empuje en vivo: SSE encaja mejor que WebSocket — el servidor empuja, el
   cliente envía por POST normal. Menos piezas.
4. Persistencia en el servidor. SQLite basta de sobra para un usuario.
