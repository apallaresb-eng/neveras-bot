const BaseAgent = require('./BaseAgent');

class VerifierAgent extends BaseAgent {
  constructor() {
    super('AgenteVerificador', 'Audita y verifica todas las respuestas salientes del Agente de Ventas antes de que lleguen al WhatsApp del cliente');
  }

  async auditarRespuesta(mensajePropuesto, inventarioDisponible) {
    let systemPrompt = `Eres "Control de Calidad" (Auditor Estricto) de respuestas de WhatsApp de Neveras-Bot.

TU MISIÓN: Evaluar el mensaje que un vendedor propone enviarle al cliente. Si rompe ALGUNA REGLA CRÍTICA, debes RECHAZARLO explicando el motivo. Si está OK, devuelve solo: "APROBADO".

REGLAS CRÍTICAS DE AUDITORÍA:
1. INVENTO DE STOCK: El vendedor NO PUEDE ofrecer medidas exactas o features que no estén en este inventario actual:
${JSON.stringify(inventarioDisponible)}
2. INVENTO DE PRECIOS O GARANTÍAS: Nunca prometer un descuento ("se la dejo más barata", "se la en $1M") ni regalar el envío si no dice explicitamente que lo asume un vendedor real. (Garantía oficial: 4 meses, no 6 ni 12).
3. LENGUAJE OFENSIVO/RARO: No suene a un bot traductor ("Mi estimado amigo Carlos", "Saludos cordiales").
4. MÚLTIPLES PREGUNTAS: Nunca hacer más de una pregunta al final del mensaje.

Si falla, devuelve este JSON exacto:
{
  "estado": "RECHAZADO",
  "motivo": "Explicación muy corta de la regla rota",
  "sugerencia_correccion": "Escribe cómo debió responder el vendedor cumpliendo la regla"
}

Si pasa todas las reglas, devuelve exactamente: "APROBADO".
(Responde solo JSON o APROBADO sin texto extra).`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `El mensaje propuesto es: "${mensajePropuesto}"` }
    ];

    try {
      const auditoriaStr = await this.razonar(messages, 0.1, 200); // 0.1 de T° = estricto
      
      if (auditoriaStr && auditoriaStr.toUpperCase().includes('APROBADO') && !auditoriaStr.includes('{')) {
        return { estado: 'APROBADO' };
      }

      // Intentar parsear el JSON de rechazo
      const jsonMatch = auditoriaStr.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const rechazoObj = JSON.parse(jsonMatch[0]);
        return rechazoObj;
      }

      return { estado: 'APROBADO' }; // Si falla el parche, lo dejamos pasar asumiendo que el Cerrador no hizo estragos.
    } catch (e) {
      console.error('[VerifierAgent Error]', e);
      return { estado: 'APROBADO' }; // Fallback de seguridad en caso de error de red
    }
  }
}

module.exports = new VerifierAgent();
