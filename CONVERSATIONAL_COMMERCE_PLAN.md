# Abi Conversational Commerce Plan

Objetivo: que Abi entienda al cliente colombiano como habla en la vida real, desde el saludo hasta el cierre, sin obligar al cliente a hablar "como robot", y sin perder autoridad de negocio sobre catálogo, precios, total, dirección, pago y estado.

## Principios

1. **El cliente no debe adaptarse a Abi.** Abi debe adaptarse al cliente.
2. **Backend como autoridad.** Catálogo, precios, total, descuentos, customer type y estado del pedido no se improvisan.
3. **GPT interpreta; backend valida; GPT redacta.**
4. **Resolver primero, preguntar después.** Solo pedir aclaración cuando la ambigüedad sea real.
5. **Cero repetición tonta.** No repetir saludo, catálogo, ni faltantes completos en cada turno.
6. **Colombiano natural.** Cubrir lenguaje popular, neutro y formal sin estereotipos ofensivos.

## Qué debe entender Abi

### 1) Aperturas y saludos
- hola
- buenas
- buen día
- oye
- amiga
- reina
- veci
- disculpa
- una pregunta
- información
- me regalas el catálogo

### 2) Pedidos directos e indirectos
- quiero 2 aloe litro
- me manda 3 griegos
- regalame un kefir
- apúntame 4
- para pedir un yogurt
- necesito algo para hoy
- quiero lo mismo de siempre

### 3) Variantes de producto
- grande / pequeño
- litro / 1000 / 1 litro / lt
- con fruta / natural / sin azúcar / poca azúcar
- typo real: aloe, aloi, yogur, yogurt, kefir, kefirr
- referencias humanas: el barato, el grande, el primero, ese mismo, el otro

### 4) Cantidades coloquiales
- 2 más
- otro
- otros 3
- súmale uno
- quítale uno
- déjame solo 2
- mejor 4

### 5) Dirección
- centro
- por la bomba
- al lado de la iglesia
- cl 10 # 20-30
- barrio tal, casa tal
- donde siempre
- a la misma dirección
- te comparto ubicación luego

### 6) Pago
- nequi
- daviplata
- transferencia
- efectivo
- contraentrega
- te mando comprobante
- ya te pago
- pago cuando llegue

### 7) Correcciones y fricción
- no entendiste
- así no era
- te dije 2 no 3
- no ese no
- borra eso
- empecemos de nuevo
- espera

### 8) Cierre
- listo
- dale
- perfecto
- gracias
- quedo atenta
- bueno mi amor
- bye
- hablamos luego

## Capas que hay que fortalecer

## A. Cobertura conversacional
Abi debe clasificar mejor:
- saludo
- catálogo
- precios
- pedido nuevo
- agregar producto
- quitar producto
- cambiar cantidad
- corrección
- dirección
- pago
- confirmación
- reorder
- cierre
- molestia/confusión
- pedir humano

## B. Memoria corta útil
Guardar y usar:
- último producto mencionado
- última familia de producto
- última dirección válida
- último método de pago
- customer type inferido o confirmado
- último pedido confirmado
- última sugerencia mostrada
- última ambigüedad pendiente

## C. Catálogo y precios como verdad dura
Abi no "aprende" precios de memoria libre.
Abi debe leer y resolver siempre contra catálogo activo:
- precio público
- precio distribuidor
- nombre canónico
- aliases
- variantes por tamaño/presentación

## D. Anti-repetición
Evitar repetir en cada turno:
- "Hola, soy Abi..."
- link de catálogo completo
- lista completa de faltantes cuando solo falta 1 dato
- resumen entero del pedido si el cliente solo dijo "nequi"

## E. Redacción más humana
Objetivo de estilo:
- corta
- cálida
- resolutiva
- colombiana natural
- comercial sin sonar guionada
- diferente entre turnos similares

## Matriz mínima de validación que debemos cubrir

### Saludo / descubrimiento
- cliente nuevo saluda
- cliente nuevo pide catálogo
- cliente nuevo pregunta precios
- cliente nuevo pregunta quién atiende

### Pedido básico
- producto + dirección + pago en un mensaje
- producto primero, luego dirección, luego pago
- producto ambiguo con resolución suave
- typo + cantidad + tamaño

### Pedido conversacional humano
- agrega uno más
- quita ese
- no, mejor el otro
- el mismo de la otra vez
- donde siempre
- pago como siempre

### Público vs distribuidor
- cliente público pregunta precio
- cliente distribuidor pregunta precio
- cambio de tipo de cliente
- precio correcto en respuesta y persistencia

### Fricción real
- audio mal transcrito parcialmente
- cliente molesto
- cliente manda mensaje incompleto
- cliente manda solo ubicación o solo pago
- cliente corrige a mitad del flujo

### Cierre
- cierre después de pedido confirmado
- cierre sin pedido
- agradecimiento corto
- despedida después de catálogo

## Fases de trabajo recomendadas

### Fase 1 — cobertura y diagnóstico
- inventario de intents actuales
- inventario de huecos conversacionales
- matriz de escenarios reales colombianos
- fixtures por saludo, pedido, corrección, pago, dirección y cierre

### Fase 2 — interpretación humana fuerte
- mejorar heurísticas e intent routing
- ampliar aliases, familias y referencias humanas
- mejorar continuidad multi-turno
- resolver mejor pronombres y referencias como "ese", "el otro", "lo mismo"

### Fase 3 — precios y customer type blindados
- endurecer clasificación público/distribuidor
- validar siempre precio por tipo de cliente
- no responder precio equivocado aunque GPT lo sugiera

### Fase 4 — redacción premium anti-repetición
- biblioteca de respuestas por intención
- variación controlada
- respuestas más cortas para texto y audio
- evitar muletillas repetidas

### Fase 5 — stress test real
- casos coloquiales
- casos formales
- typos
- audio transcrito imperfecto
- conversaciones largas
- reorder y correcciones

## Prioridad inmediata

1. Crear una matriz grande de casos reales de conversación colombiana.
2. Medir contra el motor actual dónde falla Abi.
3. Ajustar routing, memoria y resolución de producto.
4. Ajustar redacción para no repetir ni sonar robótica.
5. Repetir validación hasta que pase los escenarios críticos.

## Regla de producto
No buscar que Abi suene "inteligente".
Buscar que Abi **venda bien, entienda bien y cierre bien**.
