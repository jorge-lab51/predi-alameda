# Prompt de lenguaje visual — sistema "Horas"

Copia todo lo que sigue como instrucción para aplicar este lenguaje visual a otra PWA.

---

Aplica a esta app el siguiente lenguaje visual. Es un sistema monocromo, geométrico y tipográfico, pensado para PWA en iPhone con modo claro y oscuro invertidos. No inventes colores ni tipografías fuera de lo indicado. Donde la app necesite algo que no está definido aquí, deriva la solución de estas reglas en vez de agregar estilos nuevos.

## 1. Concepto

- **Monocromo.** Todo se construye con una escala de grises. El color aparece solo en dos acciones semánticas: terminar o detener (rojo terracota) y reanudar o confirmar avance (verde).
- **La tipografía es el elemento gráfico principal.** Los números grandes son la imagen de la app. No hay ilustraciones ni fotos.
- **Estructura en tres bandas** en pantallas principales: arriba el dato clave en tamaño enorme, al medio una lista desplazable de tarjetas, abajo un panel fijo de acciones con esquinas superiores redondeadas.
- **Tarjetas sobre fondo gris**, separadas entre sí, con borde de un píxel. Una tarjeta puede invertirse (fondo tinta, texto claro) para destacar algo especial, nunca más de una o dos por pantalla.
- **Progreso circular.** El avance temporal se muestra con anillos SVG que se llenan con `stroke-dasharray`, remates redondos, girados para empezar arriba.

## 2. Tokens de color

Define los tokens en `:root`. El modo oscuro es el claro invertido: fondo y tinta intercambian papel.

```css
:root {
  --bg: #e6e6e6;        /* fondo de página */
  --surface: #f5f5f5;   /* tarjetas, paneles, hojas */
  --surface-2: #d8d8d8; /* pistas de anillos y barras, fondos de píldoras segmentadas */
  --text: #0b0b0b;      /* texto principal, anillo principal */
  --text-2: #737373;    /* texto secundario */
  --border: #cbcbcb;    /* bordes de un píxel */
  --ink: #0b0b0b;       /* relleno de botón primario y tarjeta invertida */
  --ink-text: #f5f5f5;  /* texto sobre --ink */
  --danger: #d9472e;    /* detener, eliminar, error */
  --success: #2e8f5a;   /* reanudar, meta cumplida */
  --on-color: #ffffff;  /* texto sobre --danger y --success */
  --ring-hr: #8f8f8f;   /* anillo secundario */
  --radius: 18px;
  --pill: 999px;
  color-scheme: light;
}

/* Oscuro: automático por sistema salvo que el usuario fuerce claro */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { /* mismos valores que el bloque siguiente */ }
}
/* Oscuro forzado por el usuario */
:root[data-theme="dark"] {
  --bg: #0b0b0b;
  --surface: #171717;
  --surface-2: #262626;
  --text: #ececec;
  --text-2: #8c8c8c;
  --border: #2c2c2c;
  --ink: #ececec;
  --ink-text: #0b0b0b;
  --danger: #e8654d;
  --success: #47b273;
  --ring-hr: #6a6a6a;
  color-scheme: dark;
}
```

Reglas:
- Nunca uses un color literal en componentes. Siempre un token.
- El tema tiene tres estados: Auto, Claro, Oscuro. Se guarda en almacenamiento local y se aplica con `data-theme` en `<html>` mediante un script inline en `<head>` antes de cargar el CSS, para evitar parpadeo.
- Actualiza `<meta name="theme-color">` al cambiar de tema con el valor de `--bg`.

## 3. Tipografía

- **Familia:** Space Grotesk, fuente variable de 300 a 700, incluida en el repo como `woff2` con licencia OFL. Fallback: `-apple-system, BlinkMacSystemFont, system-ui, sans-serif`.
- **`font-variant-numeric: tabular-nums` en `body`.** Los dígitos no deben saltar al cambiar.
- **Peso 500 para casi todo.** Regular 400 solo en texto secundario largo. 700 únicamente en el botón de acción de un aviso.

| Rol | Tamaño | Peso | Tracking |
|---|---|---|---|
| Dato principal (encabezado) | 76px | 500 | −0.05em |
| Dato del panel inferior | 44px | 500 | −0.04em |
| Título de hoja | 22px | 500 | −0.02em |
| Cifra en tarjeta | 22px | 500 | −0.02em |
| Título de barra | 16px | 500 | 0.01em |
| Texto de tarjeta | 16px | 500 | 0 |
| Botón | 16px | 500 | 0 |
| Secundario | 13–14px | 400 | 0 |

- Las etiquetas en español se capitalizan solo en la primera letra. No uses `text-transform: capitalize` porque capitaliza preposiciones.
- Fechas y horas con `Intl.DateTimeFormat('es-CL')`, formato 24 horas.

## 4. Forma y espacio

- Radio de tarjetas y elementos de menú: `--radius` (18px). Paneles y hojas inferiores: 24px solo en esquinas superiores.
- Botones, chips y selectores segmentados: `--pill`.
- Márgenes laterales de página: 20px. Separación entre tarjetas: 8px. Separación entre botones: 10px.
- Altura de botón: 52px. Altura mínima de tarjeta: 68px.
- Bordes siempre de 1px con `--border`. Sin sombras, salvo la hoja modal (`0 -8px 32px rgba(0,0,0,.2)`).
- Respeta `env(safe-area-inset-top)` y `env(safe-area-inset-bottom)`. La página mide `100dvh` sin scroll de cuerpo; solo la banda central se desplaza.

## 5. Componentes

**Botón primario:** fondo `--ink`, texto `--ink-text`.
**Botón secundario:** transparente, borde `--border`, texto `--text`.
**Botón de detener:** fondo `--danger`, texto `--on-color`. Va siempre a la izquierda.
**Botón de reanudar:** fondo `--success`, texto `--on-color`.
**Botón destructivo en hojas (eliminar):** transparente, borde `--border`, texto `--danger`.
**Enlace discreto** (descartar, cancelar suave): 13px, `--text-2`, subrayado con `text-underline-offset: 3px`.
Todos los botones: `transform: scale(.97)` y `opacity: .85` en `:active`, sin hover.

**Tarjeta:** grid de tres columnas cuando lleva indicador: `40px 1fr auto`. Indicador a la izquierda, texto al medio en dos líneas (principal 16px y secundario 13px), cifra a la derecha.
**Tarjeta invertida:** fondo `--ink`, texto `--ink-text`, borde `--ink`. El secundario baja a opacidad .6.

**Selector segmentado:** contenedor `--surface-2` en píldora con padding 4px; opción activa fondo `--ink` y texto `--ink-text`; inactivas en `--text-2`. Se usa tanto para modos de formulario como para el tema.

**Chips de opción:** píldora con borde `--border`, 15px, peso 500; seleccionado fondo `--ink`. Un `<small>` interno en `--text-2` para una anotación breve.

**Hoja modal:** `<dialog>` nativo anclado abajo, ancho completo, `--surface`, esquinas superiores 24px, backdrop `rgba(0,0,0,.45)`. Se cierra tocando fuera. Contenido con gap 14px. Botones al pie en fila.

**Campos:** fondo `--bg`, borde `--border`, radio 14px, 18px de texto, etiqueta encima en 13px `--text-2`. Foco: outline 2px `--text`.

**Aviso (toast):** píldora `--ink` con texto `--ink-text` 14px, centrada sobre el panel inferior. Puede llevar una acción en el mismo renglón, en 700 y subrayada. Se oculta solo a los 2,2 s, o 7 s si tiene acción. Debe respetar `[hidden]`.

**Barra de progreso:** pista `--surface-2` de 6px, relleno `--ink`, radio 3px, `transition: width .4s`. Cambia a `--success` al completar.

**Anillo de progreso (SVG):**
```html
<svg viewBox="0 0 100 100">
  <circle class="track" cx="50" cy="50" r="44"/>
  <circle class="arc arc-main" cx="50" cy="50" r="44"/>
  <circle class="track" cx="50" cy="50" r="31"/>
  <circle class="arc arc-secondary" cx="50" cy="50" r="31"/>
</svg>
```
```css
circle { fill: none; stroke-width: 7; }
.track { stroke: var(--surface-2); }
.arc { stroke-linecap: round; transform: rotate(-90deg); transform-origin: center;
       transition: stroke-dasharray .3s linear, opacity .3s; }
.arc-main { stroke: var(--text); }
.arc-secondary { stroke: var(--ring-hr); }
```
El relleno se controla con `stroke-dasharray: "${frac * 2πr} ${2πr}"`. Con fracción cero se pone `opacity: 0` para que el remate redondo no dibuje un punto. Para tarjetas, la versión pequeña mide 40px, radio 15 y trazo 3.5. Estados en pausa: los arcos bajan a opacidad .45.

## 6. Iconografía y app icon

- Sin librerías de iconos. Los pocos glifos necesarios son caracteres tipográficos: `‹ › ⋯ +`.
- El ícono de la app es el anillo del sistema: fondo `#0b0b0b`, anillo exterior claro `#ececec` a dos tercios, anillo interior gris `#8c8c8c` a un cuarto, pista `#282828`. Elemento principal al 74% del lienzo, trazo al 9%, remates redondos. Cuadrado sin esquinas recortadas, maestro de 1024px, derivados de 180, 192 y 512, más una versión maskable con 6% extra de margen. Para otra app, cambia el motivo del anillo por el motivo de esa app pero conserva fondo, proporciones y monocromía.

## 7. Movimiento

Solo transiciones funcionales: relleno de barras y anillos, escala de botones al pulsar, entrada del aviso (`opacity` y 8px de desplazamiento en .2s). Nada decorativo, nada que dure más de .4s.

## 8. Lo que no se hace

- Ni degradados, ni sombras en tarjetas, ni bordes de más de un píxel.
- Ni azul de sistema, ni colores de marca. Solo la escala de grises más los dos semánticos.
- Ni `capitalize`, ni mayúsculas sostenidas.
- Ni íconos de librerías, ni emojis en la interfaz.
- Ni frameworks CSS. Estilos propios sobre estos tokens.
