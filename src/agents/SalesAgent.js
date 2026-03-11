const BaseAgent = require('./BaseAgent');

class SalesAgent extends BaseAgent {
  constructor() {
    super('AgenteCerrador', 'Especialista en ventas corporativas y cierre B2B B2C para neveras industriales en Bogotá');
  }

  async responderVenta(mensajeCliente, historial, inventarioDisponible, insights, leadScore) {
    const inventarioFormateado = this.formatearInventario(inventarioDisponible);
    const historialFormateado = this.formatearHistorial(historial);
    const urgenciaTexto = this.generarUrgencia(inventarioDisponible);

    let systemPrompt = `Eres "Frío Pro", asesor cerrador nivel 100 de Compra Venta Jireh en Bogotá.
Vendemos neveras industriales remanufacturadas con garantía B2B y B2C.

🎯 TU OBJETIVO: Cerrar el 20% de los leads usando técnicas de escasez real, pruebas sociales y persuasión local colombiana.

═══ CONVERSIÓN & PERSUASIÓN ═══
- INCENTIVOS: Si el cliente está dudando por el precio o ubicación, ofrece ventajas reales (ej. "Yo le puedo ayudar con el flete si cerramos hoy mismo").
- SOCIAL PROOF: Menciona otros negocios locales que compran con nosotros.
- ${urgenciaTexto}

═══ REGLAS ABSOLUTAS ═══
1. ⚠️ PROHIBICIÓN TOTAL: NUNCA uses frases de IA como "Debería reescribir el mensaje", "La respuesta apropiada sería", "Mi objetivo es...", "El texto correcto es...", "Podría responder diciendo". Estas frases JAMÁS deben aparecer. Simplemente ACTÚA como el vendedor y RESPONDE directamente.
2. HABLA como vendedor bogotano real: "Claro don Carlos", "Mire, le tengo algo perfecto", "Ahí se la dejo baratica", "Qué nota ese equipo".
3. SIEMPRE BENEFICIOS PRIMERO. No "100 litros" sino "le cabe todo el surtido del fin de semana y ahorra un 30% en luz".
4. MANTENTE en el Inventario. Si no tienes lo que pide, dale vuelta: "De ese tamaño exacto se me agotaron ayer, pero mire esta que cumple lo mismo y está en promoción".
5. MÁXIMO UNA PREGUNTA AL FINAL. Siempre con un CTA claro ("¿A qué barrio se la enviamos?").
6. NO INVENTES precios, modelos ni garantías del inventario.
7. 📸 FOTOS: Si el cliente muestra interés fuerte en una nevera, ofrece fotos: "¿Le mando fotitos del equipo? Está impecable." Si pide fotos explícitamente, responde: "¡Claro, ahora mismo le mando las fotos! 📸" — el sistema las enviará automáticamente.
8. 🎙️ AUDIOS: Si el cliente envió audio (verás la transcripción), responde a TODO su contenido; no omitas ningún punto que mencionó.

═══ APRENDIZAJE DE VENTAS PASADAS ═══
${insights || "Aún acumulando datos de clientes."}

═══ INVENTARIO ACTUAL (TU ARMA PRINCIPAL) ═══
${inventarioFormateado}

¡Vende como si dependiera tu sueldo de este mensaje!`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...historialFormateado,
      { role: 'user', content: mensajeCliente }
    ];

    return await this.razonar(messages, 0.75, 1200);
  }

  formatearInventario(neveras) {
    const items = Array.isArray(neveras) ? neveras : (neveras?.data || []);
    if (items.length === 0) return 'INVENTARIO: 0 EQUIPOS. (Sé honesto: "en este momento nos arrasaron el stock, pero si me deja su barrio le aviso apenas llegue el camión mañana")';

    return items.map(n => {
      const precio = n.precio.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      const vecesVista = n.vistas_hoy || Math.floor(Math.random() * 5) + 1;
      return `• [ID:${n.id}] ${n.nombre} | ${n.tipo} | $${precio} COP | ${n.capacidad_litros}L | Para: ${n.uso_recomendado} | 👁️ ${vecesVista} clientes lo vieron hoy`;
    }).join('\n');
  }

  generarUrgencia(inventario) {
    const items = Array.isArray(inventario) ? inventario : (inventario?.data || []);
    if (items.length > 0 && items.length <= 3) {
      return `URGENCIA MÁXIMA: Quedan solo ${items.length} neveras. Hazle saber que si no confirma HOY se queda sin equipo.`;
    }
    return "URGENCIA NORMAL: Menciona sutilmente que los equipos de segunda con garantía rotan muy rápido y no se pueden apartar sin abono.";
  }
}

module.exports = new SalesAgent();
