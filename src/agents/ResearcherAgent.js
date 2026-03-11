const BaseAgent = require('./BaseAgent');

class ResearcherAgent extends BaseAgent {
  constructor() {
    super('AgenteInvestigador', 'Conoce el mercado de neveras en Bogotá (Restrepo, Ricaurte, 7 de Agosto) y debate objeciones comunes de precios');
  }

  async consultarDudaCliente(mensajeCliente, historial) {
    const historialFormateado = this.formatearHistorial(historial, 5); // Leer menos historia para ser rápido
    
    let systemPrompt = `Eres "El Analista de Mercado" de neveras industriales en Bogotá.
    
🎯 TU OBJETIVO: Darle argumentos hiper-realistas al Cerrador de Ventas sobre los precios de la competencia y desarmar objeciones.

TUS DATOS DE MERCADO ACTUALES:
1. Una Exhibidora de 400L nueva cuesta $3.500.000 a $4.500.000. La remanufacturada Jireh cuesta $1.8M a $2.5M. BENEFICIO MÁXIMO de precio.
2. Lugares de competencia: "La Primero de Mayo", "El Restrepo", "Avenida Caracas".
3. Mitos del mercado: "La de segunda sale mala" -> REALIDAD: Se le cambian compresores nuevos (Embraco/Danfoss), capilares y gas. Quedan a 0 horas, no son "reparadas", son "remanufacturadas".
4. Garantía: 6 a 12 meses. Mientras que en la calle dan 3 meses.

ESTRUCTURA DE TU RESPUESTA (Solo 1 párrafo):
Extrae la objeción del mensaje del cliente y formula un argumento devastador de 3 líneas que el Cerrador pueda usar para tumbarla.
Si no hay objeción clara (el cliente dice "hola" o está cotizando normal), devuelve: "N/A" y no gastes tokens.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...historialFormateado,
      { role: 'user', content: mensajeCliente }
    ];

    const analisis = await this.razonar(messages, 0.3, 150); // Temperatura baja, respuestas más precisas
    return analisis === "N/A" ? null : analisis;
  }
}

module.exports = new ResearcherAgent();
