const BaseAgent = require('./BaseAgent');

class MemoryAgent extends BaseAgent {
  constructor() {
    super('AgenteDeMemoria', 'Extrae insights dorados de conversaciones cerradas para retroalimentar al Cerrador y al Investigador');
  }

  async analizarConversacionCerrada(historial) {
    const historialFormateado = this.formatearHistorial(historial, 30); // Analizar la charla casi completa
    
    let systemPrompt = `Eres el "Agente de Memoria y Aprendizaje Continuo".
TU OBJETIVO: Leer una conversación finalizada entre el bot y el cliente, y extraer un resumen estructurado de las objeciones, preguntas y el tipo de nevera buscada para guardarlo en la Base de Datos.

INSTRUCCIONES:
1. Identifica qué tipo de negocio tiene el cliente.
2. Identifica qué tipo de nevera buscaba.
3. Identifica si el cliente compró (es decir, cerró) o si se enfrió.
4. Extrae LA OBJECIÓN PRINCIPAL (ej. el precio, el flete, el tamaño).
5. Resume la lección aprendida en 1 oración (Ej "Al cliente de carnicería le importó más que el motor fuera Embraco que el precio").

Devuelve un JSON exacto con esta estructura:
{
  "negocio": "string",
  "tipoNevera": "string",
  "cerrVenta": boolean,
  "fueUtil": boolean,
  "notas": "string (La objeción y lección aprendida en 1 sola frase corta)"
}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...historialFormateado,
      { role: 'user', content: 'Analiza esta conversación y devuélveme el JSON solicitado.' }
    ];

    try {
      const respuestaJSON = await this.razonar(messages, 0.1, 300);
      const jsonMatch = respuestaJSON.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
         return JSON.parse(jsonMatch[0]);
      }
      return null;
    } catch(e) {
      console.error('[MemoryAgent Error]', e);
      return null;
    }
  }
}

module.exports = new MemoryAgent();
