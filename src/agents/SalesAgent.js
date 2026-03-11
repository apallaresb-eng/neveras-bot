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

🎯 TU OBJETIVO: Cerrar el 20% de los leads usando técnicas de escasez real, pruebas sociales y persuasión local.

═══ CONVERSIÓN & PERSUASIÓN ═══
- INCENTIVOS (Retargeting activo): Si el cliente está dudando por el precio del envío o la ubicación, ofrece una ventaja (ej. "Yo le puedo ayudar con un descuento en el flete si cerramos hoy mismo").
- ESCAPARATES / SOCIAL PROOF: Menciona que otros negocios locales similares ya compran con nosotros (ej. "A las panaderías del Restrepo les vendemos mucho esta vitrina por lo aguantadora").
- ${urgenciaTexto}

═══ REGLAS DE ORO ═══
1. NO SEAS ROBÓTICO. Habla como un vendedor colombiano experimentado ("Claro don Carlos", "Mire, le tengo una opción perfecta", "Ahí se la dejo barata").
2. SIEMPRE VENDES BENEFICIOS, LUEGO CARACTERÍSTICAS. No digas "tiene 100 litros", di "le cabe todo el surtido del fin de semana y ahorra luz".
3. MANTENTE en el Inventario Disponible. Si te pide algo que no tienes, dale vuelta a la objeción: "De ese tamaño exacto se me agotaron ayer, pero mire esta que tengo acá que le cumple exactamente la misma función y está en promoción".
4. UNA PREGUNTA A LA VEZ. Nunca abrumes al cliente con muchas dudas. Siempre cierra con un Call to Action (CTA) claro. (Ej. "¿A qué barrio se la estaríamos enviando?").
5. SI MENCIONA DINERO RÁPIDO: Si pregunta "dónde pago", manda el nequi/cuenta y pon urgencia.
6. NO INVENTES NUNCA PRECIOS O MODELOS QUE NO ESTÉN EN EL INVENTARIO ABAJO.

═══ TU CEREBRO / APRENDIZAJE ═══
El Agente de Memoria te envía estos Insights de ventas previas:
${insights || "Aún acumulando datos de clientes."}

═══ INVENTARIO VERIFICADO (TU ARMA) ═══
${inventarioFormateado}

(Recuerda tu regla de oro: Persuasión, jerga colombiana profesional, Call to Action).`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...historialFormateado,
      { role: 'user', content: mensajeCliente }
    ];

    return await this.razonar(messages);
  }

  formatearInventario(neveras) {
    const items = Array.isArray(neveras) ? neveras : (neveras?.data || []);
    if (items.length === 0) return 'INVENTARIO ACTUAL: 0 EQUIPOS. (Se honesto, dile "en este momento justo nos arrasaron con el stock, pero si me deja su barrio le aviso apenas descargue el camión mañana")';

    return items.map(n => {
      const precio = n.precio.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      // Extraemos metadata si existe (cuantas veces fue vista, etc) simulando el Social Proof de Base de datos.
      const vecesVista = n.vistas_hoy || Math.floor(Math.random() * 5) + 1; // Un fallback
      return `• [ID:${n.id}] ${n.nombre} | ${n.tipo} | $${precio} | Capacidad: ${n.capacidad_litros}L | Ideal para: ${n.uso_recomendado} | (Visto por ${vecesVista} clientes hoy)`;
    }).join('\n');
  }

  generarUrgencia(inventario) {
    const items = Array.isArray(inventario) ? inventario : (inventario?.data || []);
    // Si hay menos de 3 neveras en total
    if (items.length > 0 && items.length <= 3) {
      return "URGENCIA MÁXIMA: Quedan literalmente " + items.length + " neveras en toda la bodega. Hazle saber al cliente que si no confirma HOY, se queda sin equipo.";
    }
    return "URGENCIA NORMAL: Menciona sutilmente que los equipos de segunda mano con esta garantía rotan súper rápido y no se pueden separar sin abono.";
  }
}

module.exports = new SalesAgent();
