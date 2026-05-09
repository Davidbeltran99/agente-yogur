# Future OCR / Vision Architecture for Handwritten WhatsApp Orders

> Estado: propuesta futura.
> No implementar ni activar en la demo actual.

## Objetivo
Permitir que Abi interprete fotos de pedidos escritos a mano o listas enviadas por WhatsApp y las convierta en pedidos estructurados guiados por el catálogo real de Tellolac.

Catálogo fuente de verdad:
- https://catalogo.treinta.co/tellolac

## Casos reales esperados
Clientes pueden enviar:
- fotos de cuadernos
- listas escritas a mano
- pedidos rápidos
- notas con productos y cantidades
- imágenes tomadas desde WhatsApp

Ejemplos de texto esperado tras OCR:
- `yogurt griego x500ml 5`
- `kefir sin azucar 7x3`
- `yogurt 1800 durazno 2`

## Fase 1 — Recepción de imagen
Entrada esperada desde WhatsApp Cloud API:
- `image` message
- foto adjunta

Flujo futuro:
1. webhook detecta mensaje tipo `image`
2. backend descarga media por WhatsApp Cloud API
3. se genera un payload temporal de procesamiento
4. el resultado textual entra al mismo pipeline actual de pedidos

## Fase 2 — OCR / Vision
Opciones futuras:
- OpenAI Vision
- GPT Vision
- OCR híbrido

Capacidades deseadas:
- escritura imperfecta
- inclinación de imagen
- abreviaciones
- sombras
- ortografía humana
- fondos no uniformes

Estrategia recomendada:
1. preprocesamiento liviano opcional
2. extracción OCR/Vision a texto crudo
3. normalización comercial del texto
4. parsing a items

## Fase 3 — Parsing comercial
Objetivo:
Convertir texto OCR a items estructurados compatibles con el flujo actual.

Ejemplo:

Texto OCR:
`yogurt x1800 mora 2`

Salida estructurada:
```json
{
  "producto": "Yogurt 1800 Mora",
  "cantidad": 2
}
```

Notas futuras:
- soportar `x500`, `500ml`, `7x3`, `2 und`, `por 3`
- mapear sabores, tamaños y presentaciones
- limpiar ruido visual y caracteres erróneos

## Fase 4 — Matching contra catálogo real
Cruzar el resultado parseado con Tellolac usando:
- fuzzy matching
- semantic matching
- aliases
- tamaños
- sabores
- presentaciones

Reglas:
- no inventar productos
- si hay varias opciones reales, pedir aclaración
- si no existe, sugerir solo productos reales cercanos del catálogo
- el catálogo sigue siendo la única fuente de verdad

## Fase 5 — Confirmación humana
Respuesta objetivo:

```text
Perfecto 😊
Te entendí este pedido:

• 2 Yogurt 1800 Mora
• 5 Yogurt Griego 500ml

¿Te ayudo con dirección y método de pago?
```

## Fase 6 — Validaciones futuras
Probar:
- letra imperfecta
- fotos inclinadas
- abreviaciones
- cantidades mezcladas
- sabores
- tamaños
- imágenes oscuras
- listas largas

## Fase 7 — Límites actuales
No activar todavía:
- OCR pesado
- procesamiento de imagen productivo
- pipelines Vision en runtime
- almacenamiento permanente de imágenes

## Integración futura recomendada
Punto de entrada sugerido:
- extender el flujo actual de `audio` para soportar `image`
- descargar media
- enviar a OCR/Vision
- tomar el texto extraído y pasarlo a `ejecutarFlujoMensaje(...)`
- guardar metadata mínima de trazabilidad

Metadata futura sugerida en `messages`:
- `message_type = image`
- `media_id`
- `ocr_text`
- `ocr_provider`
- `ocr_confidence`

## Riesgos futuros
- falsa lectura de cantidades
- confusión entre sabores similares
- OCR parcial por baja iluminación
- abreviaciones ambiguas
- costo por imagen si se usa Vision externo

## Criterio de lanzamiento futuro
Solo activar cuando exista:
- validación offline con casos reales
- umbral mínimo de confianza
- fallback claro a confirmación humana
- protección para no crear pedidos erróneos

## Commit futuro sugerido
`feat: add OCR and vision order parsing for handwritten WhatsApp orders`
