# Tellolac AI

Servicio para leer mensajes, extraer pedidos, validarlos contra catálogo real, guardar en SQLite/Google Sheets y responder por WhatsApp Cloud API con Abi como asistente.

## 1. Instalar dependencias

```bash
npm install
```

## 2. Configurar variables

Copia `.env.example` a `.env` y completa:

**Base**

- `WHATSAPP_TOKEN`
- `PHONE_NUMBER_ID`
- `WHATSAPP_VERIFY_TOKEN`
- `GOOGLE_SHEETS_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_PRIVATE_KEY` **o** `GOOGLE_APPLICATION_CREDENTIALS`
- `WHATSAPP_ENABLED=false` para pruebas locales
- `SQLITE_DB_PATH=./data/agente-yogur.sqlite`
- `DELIVERY_TIMEZONE_OFFSET_MINUTES=-300` para interpretar fechas relativas en hora Colombia

**OpenAI (único proveedor LLM)**

- `OPENAI_API_KEY=tu_api_key`
- `OPENAI_MODEL=gpt-5.4-mini`
- `OPENAI_MAX_TOKENS=160`
- `OPENAI_TEMPERATURE=0.1`
- `OPENAI_TIMEOUT_MS=30000`
- `OPENAI_TTS_MODEL=tts-1`
- `OPENAI_TTS_VOICE=alloy`
- `OPENAI_TTS_FORMAT=mp3`
- `WHATSAPP_AUDIO_RESPONSES_ENABLED=false`
- `WHATSAPP_AUDIO_REPLY_SEND_TEXT=false`

> No hay soporte para Ollama ni otros modelos locales. Si OpenAI falla, el flujo cae a parser heurístico para no romper pedidos.

## 3. Seguridad antes de GitHub

- `.env` debe quedarse fuera del repo
- `credentials/` debe quedarse fuera del repo
- no subir tokens de WhatsApp, Google ni OpenAI
- si alguna key estuvo expuesta en un commit, hay que rotarla antes del deploy

## 4. Probar solo la extracción

```bash
npm run test:manual -- "Hola, soy Laura. Quiero 2 yogures de mora y 1 de fresa para hoy en Barrio Centro. Pago por Nequi"
```

## 5. Levantar el servidor

```bash
npm run dev
```

## 6. Endpoints disponibles

- `GET /health` → salud del servicio
- `GET /orders` → lista de pedidos
- `PATCH /orders/:id/status` → cambia estado del pedido
- `GET /conversations?limit=20&offset=0&q=paula` → conversaciones paginadas y filtrables
- `GET /conversations/:phone/messages` → historial de una conversación
- `POST /conversations/:phone/send` → envío manual desde CRM; responde `{ ok: true, messageId }`
- `GET /webhook` → verificación para Meta
- `POST /webhook` → recepción real de WhatsApp
- `POST /pedido/manual` → prueba local enviando `{ "message": "..." }`

### Modelo de conversaciones

- `lastMessageOrderId` → pedido asociado al último mensaje
- `lastOrderId` → último pedido conocido de esa conversación
- `orderId` → alias de `lastMessageOrderId` **deprecated**; mantener solo por compatibilidad

### Validación automática del CRM

Con el servidor arriba, ejecuta:

```bash
npm run validate:crm
```

El script:

- arranca un navegador headless propio
- abre `http://127.0.0.1:3000/`
- selecciona la primera conversación
- envía un mensaje de prueba desde la UI
- valida persistencia en SQLite
- limpia el mensaje de prueba al final

## 6.1 Integración catálogo Treinta (FASE 5A)

Catálogo público:

```text
https://catalogo.treinta.co/tellolac
```

Comportamiento nuevo:

- si el cliente escribe sin contexto y no hay pedido activo, recibe saludo + catálogo + instrucción de compra
- si el mensaje ya tiene intención de pedido, el flujo actual sigue creando el order normalmente
- los mensajes quedan persistidos en CRM y, cuando aplica, `messages.order_id` se mantiene enlazado al pedido

Validación end-to-end:

```bash
npm run validate:catalog
```

Ese script prueba:

- usuario nuevo sin contexto → recibe catálogo
- usuario con pedido claro → se crea order
- mensajes quedan en CRM
- `order_id` queda correcto en inbound/outbound

## 6.2 Pedidos multi-item

El modelo operativo del pedido usa:

- `orders` para datos generales del pedido
- `order_items` para cada línea de producto

Campos por item:

- `id`
- `order_id`
- `producto`
- `sabor`
- `cantidad`
- `precio_unitario` *(opcional)*
- `subtotal` *(opcional)*

En el panel, la tabla muestra un resumen consolidado, por ejemplo:

```text
3 Aloe Litro, 2 Café litro, 1 Ancheta
```

Google Sheets sigue en modo **una fila por item**, repitiendo el `order_id` y los datos generales del pedido.

Validación end-to-end:

```bash
npm run validate:multi-item
```

## 6.3 Catálogo real como fuente de validación

El parser ya no acepta productos inventados ni normaliza libremente.

Se agregó la capa `catalog_products` en SQLite con:

- `id`
- `nombre`
- `precio`
- `categoria` *(opcional)*
- `aliases` *(JSON opcional)*
- `activo`

El servidor sincroniza el catálogo real desde Treinta al iniciar:

```text
https://catalogo.treinta.co/tellolac
```

Comportamiento:

- detecta varios productos por mensaje
- valida cada item contra `catalog_products`
- guarda `precio_unitario` y `subtotal` en `order_items`
- si no encuentra el producto exacto, responde con el link del catálogo
- si la coincidencia es ambigua, pide confirmación antes de crear el pedido

Validación end-to-end:

```bash
npm run validate:catalog-real
```

Sincronización manual del catálogo:

```http
POST /admin/catalog/sync
```

Respuesta esperada:

```json
{
  "ok": true,
  "total": 12,
  "active": 12,
  "inactive": 0,
  "syncedAt": "2026-05-05T16:12:10.300Z"
}
```

Validación del sync:

```bash
npm run validate:catalog-sync
```

## 7. Hoja sugerida en Google Sheets

Crear una pestaña llamada `Pedidos` con columnas:

- Fecha
- Cliente
- Producto
- Sabor
- Cantidad
- Dirección
- Fecha entrega
- Método pago
- Observaciones
- Estado

## 8. Perfil recomendado para OpenAI mini barato

Para Railway/hosting usa este perfil:

```env
OPENAI_API_KEY=tu_api_key
OPENAI_MODEL=gpt-5.4-mini
OPENAI_MAX_TOKENS=160
OPENAI_TEMPERATURE=0.1
OPENAI_TIMEOUT_MS=30000
```

Con esto el proyecto mantiene prompts cortos, costo bajo y timeout razonable.

## 9. Estado actual

Ya quedó implementado:

- validación contra catálogo real de Treinta
- parser multi-item con fallback heurístico
- OpenAI como único LLM
- guardado en SQLite + respaldo en Google Sheets
- CRM web con conversaciones persistidas
- sync manual de catálogo con `POST /admin/catalog/sync`

## 10. Deploy en Railway

### 1. Producción

Ya quedó listo con:

- `npm start`
- `const port = process.env.PORT || 3000;`
- `GET /health`

### 2. Variables de entorno necesarias en Railway

**Base obligatoria**

- `PORT` *(Railway la inyecta)*
- `WHATSAPP_TOKEN`
- `PHONE_NUMBER_ID`
- `WHATSAPP_VERIFY_TOKEN`
- `GOOGLE_SHEETS_ID`
- `SHEETS_BACKUP_ENABLED=true`
- `WHATSAPP_ENABLED=false` *(o `true` cuando se conecte WhatsApp real)*
- `SQLITE_DB_PATH=/app/data/agente-yogur.sqlite`

**Google Sheets**

Preferido en Railway:

- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`

Opcional si montas archivo fuera del repo:

- `GOOGLE_APPLICATION_CREDENTIALS`

**OpenAI**

- `OPENAI_API_KEY`
- `OPENAI_MODEL=gpt-5.4-mini`
- `OPENAI_MAX_TOKENS=160`
- `OPENAI_TEMPERATURE=0.1`
- `OPENAI_TIMEOUT_MS=30000`

### 3. SQLite persistente

En Railway hay que apuntar `SQLITE_DB_PATH` a un volumen persistente. Ejemplo:

```env
SQLITE_DB_PATH=/app/data/agente-yogur.sqlite
```

### 4. Checklist antes de subir

- confirmar `.env` ignorado
- confirmar `credentials/` ignorado
- confirmar que no hay keys en commits
- correr:

```bash
npm start
npm run validate:delivery-dates
npm run validate:crm
npm run validate:catalog-sync
npm run smoke:health
```

Respuesta esperada:

```json
{ "ok": true, "service": "tellolac-ai" }
```

### 5. Instrucciones para subirlo a Railway

1. Sube este proyecto a GitHub
2. Entra a Railway
3. Crea un proyecto nuevo → **Deploy from GitHub repo**
4. Selecciona el repo de Tellolac AI
5. Railway detectará Node.js automáticamente
6. En Variables, pega todas las variables necesarias
7. Deja el comando de arranque en:

```bash
npm start
```

8. Espera el primer deploy
9. Abre la URL pública de Railway y prueba:

```bash
/health
```

10. Si responde ok, usa esa URL para el webhook:

```bash
https://tu-app.up.railway.app/webhook
```

### 6. Checklist final para cambiar el webhook en Meta

Cuando Railway ya esté arriba:

- [ ] confirmar que `https://TU_URL_RAILWAY/health` responde
- [ ] ir a Meta Developers / WhatsApp / Configuration
- [ ] cambiar **Callback URL** a `https://TU_URL_RAILWAY/webhook`
- [ ] dejar el mismo `WHATSAPP_VERIFY_TOKEN`
- [ ] verificar y guardar
- [ ] asegurar que el campo **messages** esté suscrito
- [ ] enviar un mensaje real al número configurado
- [ ] revisar que entre respuesta y guardado en Google Sheets

## 12. Respuestas en audio por WhatsApp

Abi ya puede transcribir audios entrantes y ahora también puede responder con audio generado por TTS.

Variables nuevas:

```env
OPENAI_TTS_MODEL=tts-1
OPENAI_TTS_VOICE=alloy
OPENAI_TTS_FORMAT=mp3
WHATSAPP_AUDIO_RESPONSES_ENABLED=true
WHATSAPP_AUDIO_REPLY_SEND_TEXT=false
```

Comportamiento:

- si el cliente envía un audio, Abi puede responder con audio
- el texto de la respuesta sigue quedando guardado en CRM/SQLite
- si `WHATSAPP_AUDIO_REPLY_SEND_TEXT=true`, además del audio también envía el texto
- si el TTS falla, Abi cae automáticamente a respuesta en texto

## 13. Siguiente mejora recomendada

Lo siguiente que yo haría es:

- personalidad de voz de Abi (tono, ritmo, instrucciones de TTS)
- respuestas más cortas para audio natural
- logs de errores y reintentos
- protección básica contra mensajes vacíos o formatos no soportados

