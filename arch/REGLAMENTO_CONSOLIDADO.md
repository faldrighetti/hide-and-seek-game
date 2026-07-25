# Hide and Seek — Reglamento consolidado

**Estado:** borrador normativo consolidado  
**Versión:** 0.1  
**Principio general:** la aplicación hace cumplir las reglas objetivas y técnicamente verificables. Las reglas de conducta difíciles o desproporcionadas de controlar se aplican mediante buena fe entre los participantes.

---

## 1. Estructura general de la partida

Una partida se divide en **runs**. En cada run, una persona cumple el rol de **hider** y las demás cumplen el rol de **seekers**.

Cada run contiene, como mínimo:

1. una fase de escape;
2. una fase de búsqueda;
3. un posible endgame;
4. la captura o el vencimiento del tiempo;
5. un intermission antes del siguiente run.

El tiempo oficial y el orden de todas las acciones los determina el servidor.

---

## 2. Duración del run

- Cada run tiene una duración máxima computable de **5 horas**.
- El límite de 5 horas se mide sobre tiempo computable de run, no necesariamente sobre tiempo real transcurrido.
- Las pausas reglamentarias, incluida la pausa producida por la carta **Move**, no cuentan para ese máximo computable.
- Si el hider no es encontrado antes del límite, su resultado es de **5 horas**.
- Un run solo cuenta para el resultado final si comenzó correctamente y terminó:
  - con el estado **FOUND**; o
  - por haber alcanzado las 5 horas.
- Los runs congelados, abandonados, cancelados o interrumpidos antes de terminar no cuentan como runs completos.

---

## 3. Fase de escape

La fase de escape dura **60 minutos** y comienza al iniciarse el run.

### 3.1 Movimiento del hider

Durante esta fase, el hider puede trasladarse libremente mediante:

- caminar;
- subte;
- tren;
- colectivo.

No están permitidos Uber, taxi, bicicleta ni otros medios de transporte.

### 3.2 Movimiento de los seekers

Durante los 60 minutos, los seekers no pueden trasladarse ni mejorar deliberadamente su posición para la búsqueda.

Pueden moverse localmente para:

- comer;
- ir al baño;
- comprar algo;
- resolver necesidades similares.

Esta restricción se aplica principalmente mediante buena fe.

### 3.3 Uso de mapas

Los seekers pueden consultar mapas y planificar durante la fase de escape.

---

## 4. Estación base

### 4.1 Selección manual

Durante la fase de escape, el hider debe:

- seleccionar una estación jugable como estación base;
- poder cambiar esa selección mientras continúe la fase;
- confirmarla manualmente antes de que terminen los 60 minutos.

La selección manual contempla:

- hubs con varias estaciones;
- distancia física entre estaciones del mismo hub;
- errores o imprecisiones del GPS;
- diferencias entre el punto representativo de una estación y su extensión real.

La selección debe ser compatible con el recorrido real del hider.

### 4.2 Asignación automática

Si al finalizar la fase de escape el hider no confirmó ninguna estación, el servidor asigna automáticamente la estación jugable más cercana a su última ubicación válida.

La asignación queda registrada en el historial.

### 4.3 Hider todavía viajando

Si el hider continúa viajando cuando terminan los 60 minutos:

- su estación base debe ser la última estación válida por la que pasó;
- debe regresar a esa estación o a su hiding zone;
- no puede seleccionar como base una estación futura a la que todavía no llegó.
- al comenzar la fase de búsqueda, la hiding zone activa corresponde a esa estación asignada.

---

## 5. Hiding zone

La hiding zone es un círculo de **600 metros de radio** cuyo centro es el punto geográfico asignado a la estación base.

Durante la fase de búsqueda:

- el hider debe permanecer dentro de su hiding zone;
- puede moverse libremente dentro del círculo;
- puede cambiar de barrio si no sale de la zona;
- no puede cambiar de estación base salvo mediante la carta **Move**.

---

## 6. Área de juego

- El área jugable general es CABA.
- Las estaciones jugables están representadas mediante puntos geográficos definidos.
- Algunas estaciones jugables pueden estar fuera de CABA si están a menos de **1000 metros** de la General Paz o del Riachuelo.
- Cada estación jugable fuera de CABA extiende el área jugable mediante un círculo de **600 metros** de radio con centro en esa estación.
- La regla técnica es: un punto está dentro del área jugable si está dentro de CABA o dentro del círculo de 600 metros de cualquier estación jugable fuera de CABA.
- El borde cuenta como dentro del área jugable.
- No se puede atravesar una zona no jugable para obtener una ventaja.
- El área está diseñada para permitir desplazamientos entre ubicaciones válidas sin necesidad de salir del mapa.
- Si un jugador sale del área de manera sostenida y con ubicación fresca y confiable, se notifica a todos.

Esta regla de área jugable no reemplaza la restricción propia del hider durante la fase de búsqueda: el hider debe permanecer dentro de su hiding zone. Si sale momentáneamente por una necesidad práctica, por ejemplo buscar un baño cercano, se trata como regla social de buena fe y no como una excepción técnica ilimitada.

---

## 7. Seekers

- Debe haber al menos **2 seekers**, salvo en el modo **1v1**, que se considera un modo de test.
- Los seekers deben permanecer juntos durante la partida.
- Todos reciben la misma información.
- Todos pueden enviar preguntas.
- Todos deben compartir su ubicación.
- El hider puede ver la ubicación de los seekers.
- Se elige un capitán al azar.
- El capitán no tiene privilegios decisorios especiales.
- Si el capitán abandona, el rol pasa a otro seeker.

La obligación de permanecer juntos es, en parte, una regla social.

---

## 8. Endgame

### 8.1 Activación

La aplicación activa automáticamente el endgame cuando:

- en modos normales, hay **2 o más seekers activos** dentro de la hiding zone;
- en el modo 1v1 de test, el único seeker activo está dentro de la hiding zone;
- sus ubicaciones son suficientemente recientes;
- su velocidad GPS permanece baja durante aproximadamente 30 a 45 segundos;
- su desplazamiento no parece compatible con viajar en transporte público.

No es necesario identificar específicamente si están en tren, subte o colectivo.

### 8.2 Información a los jugadores

- El hider recibe una notificación cuando empieza el endgame.
- Los seekers no reciben una notificación explícita de que el endgame comenzó.
- El endgame no consume cartas ni recursos.

### 8.3 Obligación del hider

Durante el endgame, el hider debe permanecer fijo en un punto.

Ese punto debe:

- ser público;
- ser legalmente accesible;
- estar en planta baja;
- permitir que los seekers lleguen sin atravesar accesos restringidos;
- mantener al hider relativamente visible.

No son lugares válidos:

- propiedades privadas;
- locales comerciales;
- lugares pagos;
- pisos superiores de shoppings;
- estaciones o andenes subterráneos;
- baños;
- vestuarios;
- sectores reservados;
- espacios cuyo acceso dependa del género, una autorización o una condición especial;
- rincones deliberadamente ocultos que impidan un reconocimiento razonable.

Aunque todos los participantes pudieran entrar a un baño determinado, ese lugar sigue siendo inválido.

### 8.4 Preguntas de endgame

Los seekers pueden consultar el endgame desde la aplicación. Si el servidor confirma que el endgame está activo, se desbloquea la categoría de preguntas de endgame. Si la consulta no desbloquea endgame, el botón tiene un cooldown de 60 segundos.

Durante el endgame, los seekers pueden preguntar:

**¿En qué dirección va la calle/avenida en donde te estás parando?**

El hider debe responder en dos partes:

1. si la calle/avenida es **diagonal** u **horizontal o vertical**;
2. el punto cardinal/intercardinal correspondiente, o **doble mano**.

Si la primera respuesta es **diagonal**, la segunda debe ser una de:

- noreste;
- noroeste;
- sudeste;
- sudoeste;
- doble mano.

Si la primera respuesta es **horizontal o vertical**, la segunda debe ser una de:

- norte;
- sur;
- este;
- oeste;
- doble mano.

También pueden preguntar:

**¿Hay una parada de colectivos o un acceso a una estación en la cuadra en la que estás?**

Respuestas posibles:

- parada de colectivos;
- acceso a estación de subte o tren;
- ambos;
- ninguno.

**¿Sobre qué tipo de vía estás?**

Respuestas posibles:

- calle;
- avenida;
- otro.

### 8.5 Desactivación

El endgame se desactiva cuando los seekers permanecen fuera de la hiding zone durante **30 segundos continuos**.

La desactivación depende únicamente de la posición GPS respecto de la hiding zone. No se desactiva por velocidad, por apariencia de transporte público ni por cambios en el medio de transporte mientras los seekers sigan dentro de la zona.

Una única lectura GPS fuera de la zona no basta.

Cuando se desactiva:

- el hider recibe una notificación;
- vuelve a poder moverse dentro de su hiding zone;
- no puede comenzar a moverse antes de recibir esa notificación.

---

## 9. Encontrar y capturar al hider

### 9.1 Qué significa encontrarlo

Encontrar al hider requiere un **reconocimiento inequívoco en persona**.

No basta con:

- sospechar que una persona podría ser el hider;
- inferir que está detrás de un objeto;
- reconocer solamente su ropa, mochila o teléfono;
- divisar una figura sin identificarla inequívocamente.

### 9.2 Botón ENCONTRADO

El botón **ENCONTRADO** permanece visible durante la fase de búsqueda, pero solo se habilita cuando se cumplen las condiciones de proximidad.

La captura solo es aceptada si el endgame está activo.

Condiciones técnicas recomendadas:

- al menos un seeker está a 25 metros o menos del hider;
- las ubicaciones del hider y de ese seeker fueron recibidas en los últimos 15 segundos;
- la precisión GPS es preferentemente menor de 30 metros;
- no existe otro intento de captura activo.

La proximidad GPS habilita el procedimiento, pero no reemplaza el reconocimiento visual.

El servidor mantiene siempre la ubicación exacta del hider de manera privada. Esa ubicación no se muestra a los seekers, pero puede usarse para contrastar proximidad, endgame, captura y reglas técnicas.

### 9.3 Procedimiento de captura

Cuando un seeker pulsa **ENCONTRADO**:

1. el servidor registra la acción, la ubicación, la distancia, la precisión y el timestamp;
2. el hider recibe una notificación formal;
3. desde ese momento, el hider queda inmovilizado;
4. el hider dispone de **15 segundos** para confirmar;
5. si confirma, el estado pasa a **FOUND**;
6. si no confirma, se habilita la confirmación de los seekers;
7. se requieren dos confirmaciones de cuentas seeker distintas;
8. al registrarse la segunda confirmación, el servidor establece **FOUND**.

La operación es idempotente y solo puede existir un intento activo.

Los intentos fallidos quedan registrados y generan un cooldown técnico.

---

## 10. Preguntas

- Solo puede existir una pregunta pendiente.
- Cualquier seeker puede enviarla.
- Cuando el servidor acepta una pregunta válida, la categoría queda bloqueada durante **15 minutos** para todo el equipo seeker.
- El cooldown comienza al ser aceptada por el servidor, no al responderse.
- Las respuestas pueden ser:
  - sí o no;
  - un número;
  - una de dos opciones predefinidas.
- Cada categoría tiene un tiempo máximo de respuesta.
- La posición de referencia es la posición del hider al momento de responder.
- El hider puede consultar mapas, aplicaciones u otras fuentes.
- El hider debe responder con la verdad.
- Una respuesta técnicamente verdadera pero estratégicamente engañosa está permitida.
- Un error de buena fe forma parte del juego.
- Las respuestas pueden corregirse sin límite temporal, bajo una regla social de buena fe.
- Si antes de la corrección ocurrió una captura, Move o endgame, se presume que la respuesta incorrecta no tuvo influencia directa sobre ese resultado salvo acuerdo social explícito entre los jugadores.
- Las preguntas de distancia, dirección, matching y termómetro son validadas por la aplicación.
- Las preguntas o pistas basadas en Strava están excluidas.

---

Las preguntas de foto se resuelven por canal externo: la app no almacena imÃ¡genes ni URLs, solo registra que la foto fue enviada, recibida y validada o rebotada.

## 11. Vetos

### 11.1 Vetar pregunta

La carta **Vetar pregunta** puede usarse al recibir una pregunta.

- Es una excepción a la prohibición general de usar cartas durante una pregunta pendiente.
- El veto no es impugnable.
- La pregunta queda bloqueada por el resto del run.
- El cooldown de categoría se aplica igualmente.
- El hider puede recibir las cartas correspondientes.
- La pregunta cuenta para estadísticas.

### 11.2 Elegí tres preguntas para vetar

Esta carta permite bloquear tres preguntas durante el resto del run.

Puede activarse cuando el hider quiera, salvo mientras haya una pregunta pendiente.

### 11.3 Randomizar pregunta

**Randomizar pregunta** también constituye una excepción a la regla general que impide activar curses durante una pregunta pendiente.

---

## 12. Mazo del hider

- Solo el hider posee mazo.
- Comienza cada run con la mano vacía.
- Al recibir preguntas puede tomar una cantidad de cartas y conservar otra cantidad, según la categoría.
- La mano tiene un límite de **6 cartas**.
- Si incorpora una nueva carta con la mano llena, debe descartar una.
- Puede haber cartas duplicadas.
- Cada copia es una entidad independiente.
- Las cartas no pueden intercambiarse.
- El azar es individual para cada run.
- Los resultados aleatorios quedan registrados por el servidor.
- Cerrar y volver a abrir la aplicación no modifica el estado.

Al rebarajar pueden ingresar:

- cartas ofrecidas pero no elegidas;
- cartas nunca mostradas;
- cartas descartadas;
- cartas usadas.

Quedan excluidas:

- las cartas en mano;
- las curses activas.

Cuando termina el run, el hider deja de tener ese mazo.

---

## 13. Curses

- Una curse solo se consume después de que el servidor valida y confirma su activación.
- Los intentos inválidos no consumen la carta.
- Las activaciones son idempotentes.
- En general, no pueden activarse mientras haya una pregunta pendiente.
- Las excepciones expresas incluyen **Vetar pregunta** y **Randomizar pregunta**.
- Pueden acumularse mientras una curse activa no esté bloqueando preguntas o transporte.
- El efecto comienza cuando el hider lo activa.
- Termina cuando los seekers cumplen la penalización o cuando vence el tiempo indicado.
- El reloj sigue corriendo.
- Las curses se aplican al equipo seeker.
- Un cambio de capitán no altera su efecto.
- La desconexión se maneja igual exista o no una curse activa.

La compatibilidad entre curses debe revisarse antes de cerrar el catálogo definitivo.

---

## 14. Carta Move

El hider puede activar **Move** cuando quiera, excepto:

- durante el endgame;
- mientras haya una pregunta pendiente.

Al activarla:

- el tiempo escondido del hider se pausa;
- esa pausa no cuenta para el máximo computable de 5 horas del run;
- dispone de 20 minutos para trasladarse;
- puede elegir cualquier estación jugable;
- no puede atravesar zonas no jugables;
- los seekers no pueden moverse;
- los seekers no reciben información sobre el traslado;
- el hider conserva cartas y curses activas.

Al cumplirse exactamente los 20 minutos:

- se revela a los seekers la estación base anterior;
- se reanuda el reloj;
- entra en vigor la nueva estación base.

Si el hider llegó a la estación elegida, esa estación se convierte en su base.

Si no llegó:

- debe volver a la última estación válida por la que transitó;
- esa estación pasa a ser su nueva base.

Las respuestas vinculadas a la ubicación anterior dejan de ser relevantes, pero:

- permanecen en el historial;
- no se rehabilitan preguntas;
- no se reinician cooldowns;
- no se devuelven cartas ni recursos.

---

## 15. Intermission

Después de cada run comienza un **Intermission**.

- Su duración inicial orientativa es de 5 minutos.
- No está obligado a durar exactamente 5 minutos.
- Durante esta fase se cambian los roles.
- Incluye botones de pausa y reanudación.
- Cualquier jugador puede pausar o reanudar el Intermission.

### 15.1 Pausa

Al pausar:

- se detiene el contador;
- no comienza el siguiente run;
- los jugadores pueden comer, ir al baño o descansar;
- no corre tiempo atribuible al nuevo hider.

### 15.2 Reanudación

Al reanudar:

- el contador continúa desde donde fue pausado;
- al llegar a cero comienza la siguiente fase de escape.

Una pausa breve de Intermission no equivale a stand-by.

---

## 16. GPS y conectividad

### 16.1 Estados

La aplicación distingue:

- conectado;
- conexión degradada;
- desconectado temporalmente;
- abandono técnico.

Las irregularidades de GPS, especialmente en el subte, no deben tratarse automáticamente como desconexión.

### 16.2 Conexión degradada

Se produce cuando:

- no llega una ubicación reciente;
- la precisión es insuficiente;
- se pierde internet momentáneamente;
- el sistema operativo interrumpe actualizaciones.

La app conserva la última ubicación y muestra su antigüedad.

### 16.3 Desconexión temporal

Se declara tras **90 segundos** sin comunicación válida.

- Se mantiene la última ubicación conocida.
- Se alerta a los participantes.
- Se bloquean acciones que requieren una ubicación reciente.
- El jugador puede reconectarse con la misma identidad.

### 16.4 Abandono técnico

Se declara si la desconexión dura **5 minutos**.

La partida se congela o pasa a stand-by según la cantidad y el rol de los jugadores afectados.

### 16.5 Desconexión del hider

- Durante los primeros 90 segundos, el reloj continúa.
- Entre 90 segundos y 5 minutos, el run se congela.
- Después de 5 minutos, la partida pasa a stand-by.
- Durante el endgame, la última ubicación no puede validar automáticamente una captura.
- Una captura ya iniciada puede completarse mediante las confirmaciones ya habilitadas.

### 16.6 Desconexión de un seeker

Si siguen conectados al menos 2 seekers, la partida puede continuar.

Si quedan menos de 2:

- el run se congela;
- se espera 5 minutos;
- si no regresa nadie suficiente, la partida pasa a stand-by.

### 16.7 Permisos

El GPS es obligatorio.

Si el usuario rechaza o desactiva el permiso de ubicación:

- no puede jugar;
- la aplicación debe volver a solicitarlo;
- la desactivación durante una partida se trata como desconexión.

---

## 17. Salida del mapa

Cuando la aplicación detecta una salida:

- se abre una salida sospechada privada para el hider;
- el hider debe confirmar periódicamente que está bien y volviendo;
- comienza un período máximo de gracia de **3 minutos**;
- se intenta distinguir entre error GPS y salida real.

La alerta solo debe dispararse con ubicación reciente y precisión suficiente. Una única lectura GPS fuera del área no alcanza. Si la ubicación está desactualizada o es demasiado imprecisa, la situación se trata como conexión degradada o lectura dudosa, no como salida confirmada.

Durante una salida sospechada, la aplicación muestra al hider un botón de confirmación. Si el hider confirma dentro del plazo, la alerta global se posterga mientras siga dentro del máximo de 3 minutos. Si no confirma a tiempo, o si se cumplen los 3 minutos máximos sin volver al área jugable, todos reciben una alerta.

Para validar esta regla, el servidor puede recibir y conservar temporalmente la ubicación exacta del hider por una ruta privada. Esa ubicación no se muestra a los seekers; solo se muestran estados derivados como salida sospechada o salida alertada.

Si la salida es real:

- el jugador debe volver;
- el run se congela;
- el tiempo deja de avanzar hasta resolver la situación.

---

## 18. Sesiones y reconexión

- Solo puede existir una sesión activa por jugador.
- Una cuenta de Google representa a un único jugador.
- Si la cuenta inicia sesión en otro dispositivo, la sesión anterior se cierra o queda desconectada.
- La reconexión conserva identidad, rol, cartas y estado.
- Dos dispositivos no pueden aportar simultáneamente ubicación ni acciones.
- WhatsApp funciona como canal secundario de comunicación.

---

## 19. Emergencias

- Cualquier jugador puede declarar una emergencia.
- La acción requiere confirmación para evitar pulsaciones accidentales.
- La seguridad prevalece sobre la competencia.
- Se congela o cancela la actividad.
- Se revela la ubicación de todos, incluido el hider.
- El posible abuso se analiza después y nunca retrasa la respuesta de seguridad.

---

## 20. Abandono, cancelación y stand-by

### 20.1 Abandonar run

Abandono y rendición se tratan como una misma acción.

- Cualquier jugador puede abandonar.
- La acción requiere confirmación.
- Si abandona un seeker y quedan al menos 2, el run continúa.
- Si quedan menos de 2, el run se congela.
- Si abandona el hider, el run se congela.
- Un run incompleto no cuenta para el resultado final.

### 20.2 Cancelar partida

Cualquier jugador puede solicitar:

- poner la partida en stand-by; o
- eliminarla definitivamente.

### 20.3 Stand-by

- Congela los relojes.
- Conserva los resultados de runs terminados.
- Cualquiera puede reanudar.
- El ID de la partida permanece reservado durante **15 días** en stand-by.
- Si la partida no se reanuda dentro de ese plazo, el servidor puede eliminarla automáticamente.
- Los jugadores deben regresar de buena fe a las ubicaciones acordadas.
- El run incompleto no se retoma desde el punto exacto.
- Al reanudar, el run incompleto se descarta y comienza una nueva fase de escape de 60 minutos.

### 20.4 Eliminación definitiva

- Requiere una confirmación especialmente clara.
- Los runs incompletos no cuentan.
- Los resultados de runs ya terminados pueden conservarse en el historial.

---

## 21. Herramientas externas

Está permitido utilizar herramientas externas, salvo **Google Street View**.

La prohibición de Street View es una regla social y no se implementa mediante bloqueo técnico.

No se regulan adicionalmente:

- búsquedas web;
- mapas;
- horarios;
- redes sociales;
- cámaras públicas;
- llamadas a terceros;
- fotos geolocalizadas;
- almacenamiento interno de fotos;
- otras formas intensivas de investigación.

---

## 22. Espectadores

No hay espectadores. Solo participan jugadores activos.

---

## 23. Historial del servidor

El servidor registra, como mínimo:

- timestamps oficiales;
- posiciones;
- precisión y antigüedad del GPS;
- preguntas;
- respuestas y correcciones;
- vetos;
- cooldowns;
- cartas ofrecidas, elegidas, descartadas y usadas;
- curses;
- inicio y fin de efectos;
- intentos de captura;
- confirmaciones;
- desconexiones;
- salidas del mapa;
- pausas;
- intermissions;
- estaciones seleccionadas;
- asignaciones automáticas;
- abandonos;
- emergencias;
- cancelaciones;
- estados de stand-by.

---

## 24. Reglas sociales de buena fe

Las siguientes reglas no requieren control técnico exhaustivo:

- los seekers no mejoran deliberadamente su posición durante la fase de escape;
- los seekers permanecen juntos;
- el hider responde honestamente;
- las correcciones no se usan de manera abusiva;
- nadie utiliza Street View;
- el hider respeta su punto fijo durante el endgame;
- los jugadores avisan por WhatsApp ante problemas;
- nadie explota errores evidentes del GPS;
- las emergencias se utilizan de buena fe;
- los jugadores respetan los medios de transporte permitidos;
- al reanudar desde stand-by, todos regresan a las ubicaciones acordadas.

El objetivo es evitar overengineering y aceptar que ciertas variables solo pueden regularse mediante confianza entre participantes.

---

## 25. Parámetros todavía pendientes de calibración

Estos puntos no impiden utilizar este reglamento como base:

1. umbral exacto de velocidad GPS para detectar que los seekers ya no viajan;
2. cooldown exacto después de un intento fallido de captura;
3. tiempos máximos de respuesta de cada categoría;
4. matriz definitiva de compatibilidad entre curses;
5. tolerancia exacta para validar manualmente una estación base respecto del recorrido;
6. tratamiento visual de lecturas GPS extremadamente imprecisas;
7. textos definitivos de errores, alertas y confirmaciones.

Estos son parámetros de implementación y balance, no vacíos estructurales del reglamento.
