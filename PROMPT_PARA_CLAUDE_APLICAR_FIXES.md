# INSTRUCCIONES PARA CLAUDE — Aplicar correcciones a NeverasBot

Eres un ingeniero senior de Node.js. Tu tarea es aplicar una serie de correcciones específicas a un bot de ventas de WhatsApp. A continuación te explico cada corrección, en qué archivo va, qué cambiar exactamente y por qué.

**No inventes cambios adicionales. Solo aplica los que se listan aquí.**

---

## CORRECCIÓN 1 — `index.js`
**Problema:** La función `enviarMensajeConImagen` se llama sin el prefijo del módulo, causando ReferenceError. Las fotos nunca llegan a WhatsApp.

Busca esta línea:
```js
await enviarMensajeConImagen(
```

Reemplázala por:
```js
await whatsapp.enviarMensajeConImagen(
```

---

## CORRECCIÓN 2 — `src/agents/SalesAgent.js`
**Problema A:** La garantía dice "6 meses" pero la empresa da 4 meses.  
**Problema B:** El número de pago es un placeholder falso (`310-xxx-xxxx`).  
**Problema C:** La corrección interna del Orchestrator debe ir como parámetro, no como user message.

**Cambio A** — Busca:
```
La garantía estándar es 6 meses en compresores para equipos remanufacturados. Nunca digas "1 año" ni "garantía total" si no lo confirmó un dueño.
```
Reemplaza por:
```
✅ LA GARANTÍA ES 4 MESES en todos nuestros equipos remanufacturados. Cubre defectos eléctricos, de enfriamiento y funcionamiento. NUNCA digas "6 meses", "1 año" ni "garantía total".
```

**Cambio B** — Busca:
```
Si menciona pago: Nequi 310-xxx-xxxx / Bancolombia. Pon urgencia real.
```
Reemplaza por:
```
SI MENCIONA PAGO: No compartas datos bancarios. Di: "Perfecto, le paso con el asesor que le confirma el pedido y le envía los datos de pago. ¡Ya mero cierra!" — esto escala automáticamente al vendedor humano.
```

**Cambio C** — La función `responderVenta` debe aceptar un parámetro nuevo `instruccionCorreccion = null`. Modifica la firma así:

```js
// ANTES:
async responderVenta(mensajeCliente, historial, inventarioDisponible, insights, leadScore) {

// DESPUÉS:
async responderVenta(mensajeCliente, historial, inventarioDisponible, insights, leadScore, instruccionCorreccion = null) {
```

Luego, al inicio del cuerpo de la función, agrega esta variable justo antes de donde construyes `systemPrompt`:
```js
const bloqueCorreccion = instruccionCorreccion
  ? `\n\n⚠️ INSTRUCCIÓN INTERNA DE CALIDAD (NO MENCIONAR AL CLIENTE):\nEl auditor detectó un error en tu respuesta anterior. Corrígela siguiendo esta guía: "${instruccionCorreccion}"\nResponde directamente al cliente sin mencionar esta corrección.`
  : '';
```

Y al final del `systemPrompt`, justo antes del cierre del template literal (antes del backtick de cierre), agrega:
```js
${bloqueCorreccion}
```

---

## CORRECCIÓN 3 — `src/agents/Orchestrator.js`
**Problema:** Cuando el VerifierAgent rechaza una respuesta, el Orchestrator manda la instrucción de corrección como mensaje de usuario al SalesAgent. Esto puede filtrar texto interno al cliente.

Busca este bloque:
```js
const mensajeCorregido = await SalesAgent.responderVenta(
  `CORRECCIÓN INTERNA (NO REVELAR AL CLIENTE). Responde de nuevo, pero esta vez sigue esta guía: "${auditoria.sugerencia_correccion}". El mensaje original del cliente era: "${mensajeCliente}"`,
  historial,
  inventarioDisponible,
  contextoTotal,
  leadScore
);
```

Reemplázalo por:
```js
const mensajeCorregido = await SalesAgent.responderVenta(
  mensajeCliente,
  historial,
  inventarioDisponible,
  contextoTotal,
  leadScore,
  auditoria.sugerencia_correccion
);
```

Además, agrega detección de intención `pide_envio` en `detectarIntencionBasica`. Busca el bloque de `if` que detecta intenciones y agrega este caso antes del `return 'exploracion'`:
```js
if (msj.includes('envío') || msj.includes('envio') || msj.includes('flete') || msj.includes('despacho')) {
  return 'pide_envio';
}
```

---

## CORRECCIÓN 4 — `src/agents/VerifierAgent.js`
**Problema:** La garantía dice "6 meses".

Busca:
```
(Garantía normal 6 meses).
```
Reemplaza por:
```
(Garantía oficial: 4 meses, no 6 ni 12).
```

---

## CORRECCIÓN 5 — `src/agents/ResearcherAgent.js`
**Problema:** La garantía dice "6 a 12 meses".

Busca:
```
Garantía: 6 a 12 meses. Mientras que en la calle dan 3 meses.
```
Reemplaza por:
```
Garantía: 4 meses cubriendo defectos eléctricos y de enfriamiento. La competencia informal da 0-1 mes, si da algo.
```

---

## CORRECCIÓN 6 — `src/telegram.js`
**Problema:** El mensaje de lead caliente le dice al vendedor que use `/tomar`, un comando que ya está deprecado y responde con un error.

Busca:
```js
`👉 *Para atenderle:* /tomar ${datosLead.telefono}\n` +
`_(Escribe ese comando para iniciar el chat con el cliente)_`
```
Reemplaza por:
```js
`👉 *Para atenderle:* Ve al SuperGrupo → busca el Hilo del cliente y escribe directamente ahí.\n` +
`_(Si el cliente vuelve a escribir, el hilo se crea automáticamente)_`
```

---

## CORRECCIÓN 7 — `src/agents/MarketingAgent.js`
**Problema A:** Regex de formato de precio usa doble backslash (`\\B`) en lugar de simple (`\B`). Los precios en los posts de Facebook salen sin formato (ej: `1500000` en vez de `1.500.000`).

Busca:
```js
nevera.precio.toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g, '.')
```
Reemplaza por:
```js
nevera.precio.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
```

**Problema B:** El sistema puede publicar la misma nevera muchas veces de forma aleatoria, lo que puede ser detectado como spam por Facebook Marketplace.

Busca el bloque del loop que construye `seleccionadas`:
```js
const seleccionadas = [];
for(let i = 0; i < cantidadDeseada; i++) {
    const randomIndex = Math.floor(Math.random() * items.length);
    seleccionadas.push(items[randomIndex]);
}
```
Reemplázalo por:
```js
const seleccionadas = this.seleccionarSinExcesivasRepeticiones(items, cantidadDeseada);
```

Luego agrega este nuevo método a la clase `MarketingAgent`, justo antes del método `redactarCopyParaRedes`:
```js
seleccionarSinExcesivasRepeticiones(items, cantidad) {
  const seleccionadas = [];
  const conteoRepeticiones = new Map();
  const maxPorNevera = Math.ceil(cantidad / items.length) + 1;

  // Primera pasada: una de cada una, orden aleatorio
  const shuffled = [...items].sort(() => Math.random() - 0.5);
  for (const item of shuffled) {
    if (seleccionadas.length >= cantidad) break;
    seleccionadas.push(item);
    conteoRepeticiones.set(item.id, 1);
  }

  // Segunda pasada si aún faltan
  let intentos = 0;
  while (seleccionadas.length < cantidad && intentos < 1000) {
    const item = items[Math.floor(Math.random() * items.length)];
    const actual = conteoRepeticiones.get(item.id) || 0;
    if (actual < maxPorNevera) {
      seleccionadas.push(item);
      conteoRepeticiones.set(item.id, actual + 1);
    }
    intentos++;
  }

  return seleccionadas;
}
```

---

## VERIFICACIÓN FINAL

Después de aplicar todos los cambios, confirma que:
- [ ] `index.js` llama `whatsapp.enviarMensajeConImagen(...)` con el prefijo
- [ ] `SalesAgent.js` dice "4 meses" en la garantía
- [ ] `SalesAgent.js` no tiene ningún número de Nequi hardcodeado
- [ ] `SalesAgent.js` acepta el parámetro `instruccionCorreccion`
- [ ] `Orchestrator.js` pasa `mensajeCliente` limpio (no el texto de corrección) como primer argumento
- [ ] `VerifierAgent.js` dice "4 meses"
- [ ] `ResearcherAgent.js` dice "4 meses"
- [ ] `telegram.js` no menciona `/tomar` en `notificarLeadCaliente`
- [ ] `MarketingAgent.js` usa `\B` (simple) en la regex de precio
- [ ] `MarketingAgent.js` tiene el método `seleccionarSinExcesivasRepeticiones`

Si encuentras alguna ambigüedad al buscar el texto exacto, muéstrame el bloque original que encontraste y te confirmo si es el correcto.
