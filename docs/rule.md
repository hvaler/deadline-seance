# Deadline Séance — la regla de decisión (borrador)

## 2026-11-12 — Borrador 1, para corregir

Documento de trabajo, **no es código** ni se sube al repositorio tal cual. Cuando esté cerrado se convertirá en
la entrada de la spec de Kiro (requirements) y en `.kiro/steering/product.md` de `deadline-seance`.
Las preguntas abiertas están marcadas con **[DECIDIR]**.

### 1. Qué entra

Todo es un **número entero**, para que no haya redondeos y los PBT comparen con `===`.

| Dato | Qué es | Origen |
|---|---|---|
| `tickets[]` | `key` (p. ej. `CRYPT-12`), `title`, `effort` (puntos que quedan, ≥ 0), `cod` (coste del retraso por semana, ≥ 0), `mustHave` (sí o no), `dependsOn[]` (claves) | tablero de ejemplo o CSV de Jira |
| `people[]` | `name` y `pointsPerDay` (≥ 0) | tablero |
| `daysOff[]` | días que una persona no está (vacaciones) | tablero, opcional |
| `now` | fecha y hora de «ahora» | **siempre un dato de entrada**, nunca el reloj del sistema, para que la regla sea determinista y se pueda probar |
| `freezeAt` | fecha y hora de la congelación | la vela |
| `nextReleaseWeeks` | semanas hasta la versión siguiente (a donde van los enterrados) | tablero, por defecto 2 |

### 2. La capacidad

```
capacidad = Σ por persona ( días laborables entre now y freezeAt en que la persona está × pointsPerDay )
```

- Días laborables: de lunes a viernes. Un día empezado cuenta si `now` es antes de las 12:00. **[DECIDIR]** ¿Así,
  o en medios días?
- Arrastrar la vela cambia `freezeAt`. Quitar a una persona la saca de `people`. Las dos cosas solo recalculan este
  número, y la regla vuelve a resolver.

### 3. El coste de enterrar

Enterrar un ticket lo retrasa `nextReleaseWeeks` semanas, así que cuesta `cod × nextReleaseWeeks`. Como el
retraso es el mismo para todos, **minimizar el coste enterrado** es lo mismo que **maximizar el `cod` salvado**.
Ese es el objetivo.

### 4. La regla

Se elige el conjunto de tickets **salvados** `S` que:

1. **Cabe**: `Σ effort(S) ≤ capacidad`.
2. **Respeta los imprescindibles**: todo `mustHave` está en `S`.
3. **Respeta las dependencias**: si un ticket está en `S`, todo lo que necesita (`dependsOn`, en cadena) también.
4. **Maximiza** `Σ cod(S)`.
5. **Desempate determinista**, en este orden: (a) enterrar menos tickets; (b) enterrar menos esfuerzo… **[DECIDIR]**
   (c) el orden alfabético de las claves enterradas. Así, dos personas con el mismo tablero ven siempre las mismas
   tumbas.

Todo lo que no está en `S` se **entierra**.

**Casos que la regla tiene que decir en voz alta, sin LLM:**
- **Congelación imposible**: si los imprescindibles con sus dependencias ya superan la capacidad, no hay solución.
  La pantalla dice «Los imprescindibles necesitan 54 puntos; hay 41. Hay que mover la vela o quitar un
  imprescindible», con los números calculados por la regla.
- **Dependencias en ciclo** o hacia una clave que no existe: el tablero se rechaza al cargarlo y se dice cuál es.

**Algoritmo**: es una mochila 0/1 con precedencias, un problema NP-difícil en general. Para el tamaño de un tablero
real (hasta unos 80 tickets) basta con *branch and bound* sobre los cierres de dependencias. Para los PBT se escribe
también un **oráculo de fuerza bruta** (prueba todos los subconjuntos, solo con 12 tickets o menos). El *solver*
tiene que dar siempre el mismo valor que el oráculo.

### 5. Un problema que hay que decidir antes de construir **[DECIDIR]**

Con la solución óptima, **dar más capacidad nunca reduce el valor salvado, pero sí puede cambiar qué se salva**.
Ejemplo: con 10 puntos se salvan A (6) y B (4); con 11 puede salir mejor salvar C (11) y enterrar A y B. En la
demo, el juez arrastra la vela hacia la derecha y dos tumbas **se hunden**, lo que parece un fallo.

| Opción | Qué pasa al arrastrar la vela | Ventaja | Inconveniente |
|---|---|---|---|
| **A. Óptimo puro** | las tumbas pueden saltar; la pantalla explica el cambio («C vale más que A + B juntos») | demuestra que la regla es la mejor posible, con el oráculo como prueba | puede confundir en los primeros 30 segundos del vídeo |
| **B. Línea de corte** | se ordena por `cod / effort` (WSJF) respetando dependencias, y se corta donde se acaba la capacidad; con más capacidad la línea solo baja | movimiento suave y fácil de explicar; así recorta un equipo de verdad | no es óptimo, y el juez técnico lo puede notar |
| **C. Óptimo estable** | entre las soluciones óptimas, la que menos cambia respecto a la anterior | óptimo y suave casi siempre | depende de la pantalla anterior: más difícil de probar y de explicar |

**Recomendación: A.** El salto se convierte en el momento fuerte de la demo («los espíritus han cambiado de
opinión: C vale 30 y A + B solo 22»), y la propiedad de optimalidad frente al oráculo es la mejor evidencia para
Technological Implementation. La explicación del cambio la calcula la regla; el LLM solo le pone voz.

### 6. Exhumar

Exhumar una tumba la convierte en `mustHave` y la regla vuelve a resolver. La pantalla enseña **qué se entierra a
cambio** (la diferencia entre la solución anterior y la nueva). Si exhumarla hace la congelación imposible, se dice
con números y no se aplica.

### 7. El epitafio (lo único que hace el LLM)

- El LLM recibe **solo hechos calculados**: clave, título, `effort`, `cod`, el motivo («no cabía»; «depende de
  CRYPT-7, que está enterrado»; «salvarlo obligaba a enterrar CRYPT-3 y CRYPT-9, que valen 14») y el coste
  `cod × nextReleaseWeeks`.
- **Guardia determinista**: todo número que aparezca en el epitafio tiene que estar en los hechos que se le dieron.
  Si no, el epitafio se descarta y se usa una plantilla fija. Sin clave de API, siempre se usa la plantilla, así
  que la demo funciona igual.

### 8. Propiedades para los PBT (fast-check)

Cada una es una prueba. Generadores: tableros aleatorios de 0 a 12 tickets (para el oráculo) y de hasta 80 (para
el resto), con dependencias sin ciclos.

| # | Propiedad |
|---|---|
| P1 | **Cabe**: `Σ effort(salvados) ≤ capacidad` |
| P2 | **Imprescindibles**: ningún `mustHave` está enterrado |
| P3 | **Dependencias**: si un ticket está salvado, todas sus dependencias también |
| P4 | **Partición**: salvados y enterrados no se solapan y juntos son todo el tablero |
| P5 | **Óptimo**: el `cod` salvado es igual al del oráculo de fuerza bruta (tableros de 12 tickets o menos) |
| P6 | **Más capacidad no empeora**: si la capacidad sube, el `cod` salvado no baja |
| P7 | **Determinismo**: el mismo tablero con los tickets en otro orden da exactamente las mismas tumbas |
| P8 | **Nada sobra**: ningún enterrado con `cod > 0` cabría en el hueco que queda junto con sus dependencias enterradas |
| P9 | **Imposible si y solo si**: la regla dice «imposible» exactamente cuando los imprescindibles con sus dependencias superan la capacidad |
| P10 | **Exhumar**: el exhumado queda salvado y el `cod` salvado no sube |
| P11 | **Capacidad**: adelantar la vela o quitar a una persona nunca aumenta la capacidad |
| P12 | **Guardia del epitafio**: un epitafio aceptado no contiene ningún número que no esté en sus hechos |
| P13 | **CSV de ida y vuelta**: exportar a CSV de Jira e importarlo da el mismo tablero |

### 9. Lo que no hace (alcance)

- No estima esfuerzos ni costes: son datos de la persona o de Jira.
- No escribe en Jira: exporta un CSV para importar y una nota «qué se quedó fuera y por qué».
- No usa el reloj del sistema dentro de la regla: la interfaz le pasa `now`.

### Preguntas abiertas

1. **§5**: ¿óptimo puro (A), línea de corte (B) u óptimo estable (C)?
2. **§2**: días enteros con el corte de las 12:00, o medios días.
3. **§4**: el segundo criterio de desempate (enterrar menos esfuerzo) ¿sobra?
4. ¿El `cod` lo pone la persona a mano (1–100), o se calcula con una fórmula visible (p. ej. valor × urgencia)?

## 2026-11-12 — Versión 1: decisiones

Respuestas de la persona a las preguntas abiertas del borrador 1. Donde esta sección dice otra cosa, **manda esta**.

| Pregunta | Decisión |
|---|---|
| §5, qué solución | **A. Óptimo puro**, con la explicación del cambio calculada por la regla |
| §2, unidad de capacidad | **Medios días** |
| §4, segundo desempate | **Se mantiene**: enterrar menos esfuerzo |
| Coste del retraso | **Fórmula visible** |

### 2 (sustituye). La capacidad en medios días

- Cada día laborable (lunes a viernes) tiene dos tramos: **mañana 09:00–13:00** y **tarde 14:00–18:00**, en la zona
  horaria del tablero (por defecto `Europe/Madrid`, con nombre IANA para que el cambio de hora no rompa nada).
- **Un tramo cuenta si su punto medio (11:00 o 16:00) cae en el intervalo `now ≤ medio < freezeAt`.** Es la misma
  regla para el principio y para el final: un tramo a medio empezar cuenta si aún no ha pasado la mitad, y la
  congelación a las 12:00 se queda con la mañana.
- Cada persona tiene `pointsPerHalfDay` (entero ≥ 0) en lugar de `pointsPerDay`, para que todo siga siendo entero.
  Sus ausencias (`daysOff`) también van por tramos: `2026-11-20 mañana`, `2026-11-20 tarde` o el día entero.

```
capacidad = Σ por persona ( tramos que cuentan y en que la persona está × pointsPerHalfDay )
```

### 3 (amplía). El coste del retraso con fórmula visible

Se usa la fórmula de coste del retraso de WSJF, que conocen los equipos que planifican así, con tres componentes en
la escala 1, 2, 3, 5, 8, 13, 20:

```
cod = valor + urgencia + riesgo
```

- **valor**: lo que aporta al usuario o al negocio.
- **urgencia**: cuánto pierde valor si espera (fecha comprometida, temporada).
- **riesgo**: cuánto riesgo reduce o qué otra cosa desbloquea.

La pantalla enseña la fórmula con los tres números de cada ticket, y el epitafio puede citarlos. Si un CSV trae
una columna `cod` y no las tres, se usa esa columna tal cual y la pantalla dice «coste del retraso importado».

### 4 (confirma). El desempate

Entre soluciones con el mismo `cod` salvado: (a) enterrar menos tickets; (b) enterrar menos esfuerzo; (c) orden
alfabético de las claves enterradas.

### 5 (decide). Óptimo puro con explicación del cambio

Cada vez que la regla vuelve a resolver (vela, persona, exhumar), compara la solución nueva con la anterior y
calcula: qué tickets **se levantan**, cuáles **se hunden** y cuánto cambia el `cod` salvado. La pantalla lo dice
con esos números («Se levanta CRYPT-4 (30). Se hunden CRYPT-1 y CRYPT-2 (22). Ganancia: 8»). El LLM puede ponerle
voz, con la misma guardia de números que el epitafio.

### 8 (amplía). Propiedades nuevas

| # | Propiedad |
|---|---|
| P11 (sustituye) | **Capacidad**: adelantar la vela, mover `now` hacia más tarde, quitar a una persona o añadir una ausencia nunca aumenta la capacidad |
| P14 | **Tramos**: la capacidad de un intervalo es la suma de la de dos intervalos que lo parten en cualquier punto |
| P15 | **Explicación del cambio**: `cod(se levantan) − cod(se hunden)` = cambio del `cod` salvado, y ningún ticket se levanta y se hunde a la vez |
| P16 | **Fórmula**: subir el valor, la urgencia o el riesgo de un ticket nunca hace que se entierre si antes se salvaba, con todo lo demás igual |

**Por qué P16 se cumple también con empates**: si el ticket `i` estaba salvado en la solución óptima `S` y su `cod`
sube en `δ > 0`, `S` sube `δ` y toda solución sin `i` se queda igual. Antes `S` empataba o ganaba a esas
soluciones; ahora les gana estrictamente. La nueva óptima, por tanto, contiene `i`, y el desempate solo elige entre
soluciones que ya lo salvan. Si el *fuzzing* encontrara un contraejemplo, el fallo estaría en el *solver*, no en la
propiedad.

### Estado

**Versión 1 cerrada** para pasarla a Kiro. Siguiente paso: convertirla en `.kiro/steering/product.md` (las reglas
de producto que no cambian) y en la descripción para la spec de requirements, cuando lleguen los créditos.

## 2026-11-12 — Propuesta: tickets zombi (sale del prototipo visual)

Dirección visual elegida: mezcla de película de terror de serie B de los 80 (título rojo con resplandor, VHS,
bajo de sintetizador) y supervivencia tras el apocalipsis (refugio de tablones, carteles pintados, cinta). Solo
el **género**: nada de *Thriller* ni de *The Walking Dead* (ni música, ni nombres, ni logotipos, ni imagen).

Función nueva que da sentido al disfraz, **pendiente de confirmar**:

- Cada ticket guarda `past`: cuántas versiones seguidas lleva fuera. Si hoy se queda fuera y `past + 1 ≥ 3`, es
  un **zombi**. El umbral es un dato del tablero (por defecto 3).
- Un zombi tiene dos acciones: **resucitar** (lo mismo que exhumar) o **rematarlo**: se cierra como «Won't Do» y
  sale del tablero; la regla vuelve a resolver sin él.
- En el CSV de Jira: los de fuera van a la versión siguiente; los rematados, con resolución `Won't Do`.

Propiedades nuevas si se acepta:

| # | Propiedad |
|---|---|
| P17 | **Zombi**: un ticket es zombi si y solo si está fuera y `past + 1 ≥ umbral` |
| P18 | **Rematar**: quitar un ticket enterrado del tablero no cambia el `cod` salvado ni qué se salva (ya estaba fuera, así que la solución anterior sigue siendo óptima y el desempate no la cambia) |

**2026-11-12 — Confirmado por la persona**: los tickets zombi (umbral, resucitar, rematar, P17 y P18) pasan a
formar parte del producto.

## 2026-11-12 — Alcance aprobado (versión 2)

La persona aprobó este alcance tal cual. Orden de prioridad y de recorte: 1, 2, 4 y 5 son lo que más puntúa; si
falta tiempo se recorta primero el 8, después el 6 y después el 3.

| # | Función | Qué hace | Criterio |
|---|---|---|---|
| 1 | **Cadenas de dependencias** | Entre lápidas se dibujan cadenas; al quedar fuera una dependencia, sus dependientes caen detrás en cascada | Design, Innovation |
| 2 | **Niebla de las estimaciones** | Probabilidad de que el refugio aguante con estimaciones que fallan, y un margen de capacidad | Implementation, Impact |
| 3 | **El zombi tiene hambre** | La urgencia sube un escalón por cada versión que el ticket pasó fuera | Innovation |
| 4 | **Certificado de defunción** | Nota para las partes interesadas («qué se queda fuera y por qué») en Markdown | Impact, Presentation |
| 5 | **Tour guiado** | «Play the night»: 60 s automáticos con subtítulos; también es el guion del vídeo | Presentation, Design |
| 6 | **Crónica de la noche** | Registro de cada decisión con su efecto y deshacer paso a paso | Implementation |
| 7 | **Importar CSV de Jira** | Probar con datos propios, sin credenciales | Impact |
| 8 | **La regla como servidor MCP** | Herramienta `deadline-seance` que el agente de Kiro puede consultar | Implementation |

Fuera de alcance: multijugador o votaciones, API de Jira con credenciales, un chat con IA que decida.

### 2. Niebla de las estimaciones (reglas)

- **Margen** `m` (0–30 %, de 5 en 5): la regla resuelve con `floor(capacidad × (100 − m) / 100)`.
- **Simulación**: 1.000 noches. En cada noche, cada ticket tarda `ceil(effort × f / 100)` con `f` entero entre 80
  y 150. `f` se obtiene de un *hash* de `(semilla del tablero, clave, número de noche)`: **números aleatorios
  comunes por ticket**, de modo que añadir o quitar un ticket no cambia lo que les toca a los demás.
- La noche **aguanta** si el esfuerzo simulado de lo que está dentro cabe en la capacidad completa (sin margen).
- Resultado: `floor(100 × noches que aguantan / 1.000)` %. Todo entero y determinista.

### 3. El hambre del zombi (reglas)

- Escala: 1, 2, 3, 5, 8, 13, 20. Urgencia efectiva = la urgencia del ticket subida `past` escalones, con tope en 20.
- `cod = valor + urgencia efectiva + riesgo`. Si el CSV trae un `cod` directo, no se aplica el hambre.
- La pantalla lo enseña: «urgencia 1 → 5, lleva 3 versiones fuera».

### 4. Certificado de defunción (reglas)

Texto Markdown con: congelación, capacidad y margen, lo que entra (puntos y `cod`), la probabilidad de que
aguante, y por cada ticket fuera: motivo, `cod` con su fórmula y coste de esperar; zombis; rematados. Pasa la
misma guardia de números que el epitafio.

### 6. Crónica (reglas)

Cada acción guarda una instantánea del estado (vela, margen, equipo, resucitados, rematados) y su efecto («Ana se
marcha → HB-109 fuera (−15)»). Deshacer restaura la instantánea anterior.

### 7. CSV de importación (formato)

Columnas: `Issue key`, `Summary`, `Story Points` (esfuerzo); `Value`, `Urgency`, `Risk` **o** `Cost of Delay`;
opcionales `Must Have` (yes/no), `Depends On` (claves separadas por `;`), `Times Postponed` (`past`). Errores que
se dicen con la fila: columna que falta, número no entero o negativo, urgencia fuera de la escala, dependencia a
una clave inexistente, ciclo.

### 8. Servidor MCP (reglas)

Herramientas: `solve_freeze` (tablero, `now`, `freezeAt`, equipo, margen → dentro, fuera, motivos, probabilidad) y
`what_if` (un cambio → qué entra, qué sale y la diferencia de `cod`). Usa el mismo paquete del motor que la web.

### Propiedades nuevas

| # | Propiedad |
|---|---|
| P19 | **Simulación determinista**: el mismo tablero y la misma semilla dan la misma probabilidad |
| P20 | **Menos dentro, más aguante**: si `S' ⊆ S`, la probabilidad de `S'` es ≥ la de `S` (números aleatorios comunes) |
| P21 | **Extremos**: si `Σ ceil(1,5 × effort) ≤ capacidad`, aguanta el 100 %; si `Σ ceil(0,8 × effort) > capacidad`, el 0 % |
| P22 | **Margen**: el esfuerzo de lo que entra nunca supera la capacidad con margen |
| P23 | **Hambre**: la urgencia efectiva nunca baja al aumentar `past` y nunca supera 20 |
| P24 | **Certificado**: todo número del certificado está en los hechos calculados |
| P25 | **Deshacer**: deshacer una acción devuelve exactamente la solución anterior |
| P26 | **Importación**: un CSV válido exportado por la app y vuelto a importar da el mismo tablero (amplía P13) |
| P27 | **Cascada**: si un ticket queda fuera, todo lo que depende de él también queda fuera |

**Ojo con P20**: no dice que «más margen, más aguante». Con el óptimo puro, más margen puede cambiar el conjunto
por otro que no está contenido en el anterior, y entonces la probabilidad puede bajar. La pantalla no debe
prometer lo contrario.

### 2026-11-12 — Lo que enseñó el prototipo con el tablero de ejemplo

- **Sin reserva, el refugio casi nunca aguanta**: con la vela en el viernes a las 18:00, la regla llena 59 de 59
  puntos y aguanta en el **0 %** de las 1.000 noches. Con un 15 % de reserva sube al 20 %, con un 20 % al 81 % y
  con un 30 % al 100 %. Es el mensaje central para el vídeo y el write-up: el recorte óptimo «sobre el papel» es
  frágil; hay que recortar más de lo que dice la aritmética.
- **El hambre cambia el resultado**: HB-105 (urgencia 1 → 5) y HB-113 (3 → 8) pasan de `cod` 7 y 9 a 11 y 14.
- **P20 en la práctica**: de 5 % a 10 % de reserva la probabilidad no cambia (3 %), porque la regla elige el mismo
  conjunto. La pantalla no promete que más reserva siempre suba la probabilidad.

## 2026-11-13 — Motor de reglas (spec `rule-engine`): decisiones tomadas al implementar

Lo que la spec `rule-engine` (`.kiro/specs/rule-engine/`) tuvo que decidir y este documento no decía. Donde esta
sección dice otra cosa que las anteriores, **manda esta**. El alcance de la spec es solo `src/engine`: P1–P11, P14–P18,
P22, P23 y P27. **P12** (guardia del epitafio) y **P13** (CSV de ida y vuelta) quedan para las specs de la guardia y del
CSV; P19–P21 (niebla), P24 (certificado), P25 (deshacer) y P26 (importación) también.

- **Rematar y los dependientes.** Quitar un enterrado del tablero no puede dejar libres a los tickets que dependían
  de él: si la dependencia simplemente desapareciera, esos tickets podrían salvarse y P18 se rompería. Por eso la clave
  rematada pasa a `wontDo` y **todo ticket cuya cadena llega a una clave de `wontDo` no puede salvarse nunca**
  (motivo `blocked-by-put-down`). Así P18 se cumple: el óptimo anterior sigue siendo válido y el desempate no cambia,
  porque la clave quitada estaba en todas las listas de enterrados que se comparan.
- **Solo se remata a un zombi.** El zombi es un enterrado con `past + 1 ≥ umbral`. Rematar un ticket que no es zombi, o
  uno salvado, es un error. Con una congelación imposible no hay lista de enterrados y tampoco se puede rematar.
- **P9 con rematados.** «Imposible» también ocurre si un imprescindible depende de una clave rematada, sin importar la
  capacidad. Sin claves rematadas, es exactamente el enunciado original: los imprescindibles con sus dependencias
  superan la capacidad (con margen).
- **Exhumar.** Si hace la congelación imposible, no se aplica y el motor devuelve los números (necesita, capacidad,
  capacidad con margen). Exhumar uno ya salvado no cambia nada.
- **Tiempo.** `now` y `freezeAt` son milisegundos de época enteros, para que el motor no analice fechas. Las
  ausencias son fechas locales `AAAA-MM-DD` con tramo `mañana`, `tarde` o `día entero`. La zona horaria se resuelve con
  `Intl` y el nombre IANA; el cambio de hora no desplaza los puntos medios (11:00 y 16:00 locales).
- **Desempate alfabético.** Entre dos conjuntos con el mismo `cod`, el mismo número de enterrados y el mismo esfuerzo
  enterrado, gana el que tiene la **lista de claves enterradas ordenada más pequeña** (se comparan elemento a elemento, con
  el orden de unidades de código, `CRYPT-12` antes que `CRYPT-2`). Con tres tickets iguales A, B y C y sitio para uno, se
  entierran A y B y se salva C.
- **Los tres primeros niveles del desempate en un solo entero.** Más `cod` salvado, luego más tickets salvados (menos
  enterrados), luego más esfuerzo salvado (menos esfuerzo enterrado) se plegan en un peso entero por ticket
  (`cod × K1 + K0 + esfuerzo`). Un tablero cuya aritmética no sería exacta se rechaza con `board-too-large`.
- **Explicación del cambio.** Los tickets que se levantan toman su `cod` de la solución anterior (donde estaban
  enterrados) y los que se hunden, de la nueva. P15 supone que los costes no cambian entre las dos soluciones.
- **Medido.** Con tableros de 80 tickets, la mediana de la resolución es de menos de 3 ms y el peor caso medido (muchos
  empates) unos 55 ms, en un portátil de desarrollo. El peor caso teórico sigue siendo exponencial, como en cualquier mochila.
