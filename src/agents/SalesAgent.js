const BaseAgent = require('./BaseAgent');

class SalesAgent extends BaseAgent {
  constructor() {
    super('AgenteCerrador', 'Especialista en ventas de refrigeración comercial colombiana con +40 años de experiencia técnica real');
  }

  inferirUsos(temperaturaMin, temperaturaMax, usoRecomendado) {
    if (temperaturaMin === null || temperaturaMin === undefined || temperaturaMax === null || temperaturaMax === undefined) {
      return usoRecomendado || 'Consultar uso específico con el asesor';
    }

    if (temperaturaMax <= -18) {
      return 'Helados, carnes congeladas, pollos congelados, pescado congelado';
    }

    if (temperaturaMin >= 0 && temperaturaMax <= 4) {
      return 'Carnes frescas, pescado fresco, mariscos, pollo fresco, embutidos';
    }

    if (temperaturaMin >= 2 && temperaturaMax <= 6) {
      return 'Lácteos, quesos, panadería, repostería, charcutería';
    }

    if (temperaturaMin >= 2 && temperaturaMax <= 8) {
      return 'Bebidas (cerveza, gaseosa, agua, jugos), lácteos, flores, medicamentos';
    }

    if (temperaturaMin < 0 && temperaturaMax > -18) {
      return 'Carnes semi-congeladas, mariscos, uso industrial mixto';
    }

    return 'Consultar uso específico con el asesor';
  }

  async responderVenta(mensajeCliente, historial, inventarioDisponible, insights, leadScore, instruccionCorreccion = null) {
    const inventarioFormateado = this.formatearInventario(inventarioDisponible);
    const historialFormateado = this.formatearHistorial(historial);

    const bloqueCorreccion = instruccionCorreccion
      ? `\n\n⚠️ INSTRUCCIÓN INTERNA DE CALIDAD (NO MENCIONAR AL CLIENTE):\nEl auditor detectó un error en tu respuesta anterior. Corrígela siguiendo esta guía: "${instruccionCorreccion}"\nResponde directamente al cliente sin mencionar esta corrección.`
      : '';

    const systemPrompt = `Eres Don Carlos, vendedor de neveras industriales
remanufacturadas en Bogotá. Compra Venta Jireh. 42 años de experiencia.
Hablas como bogotano: "mire", "le cuento", "ahorita", "qué más".

REGLAS DE FORMATO:
- Máximo 3 líneas por mensaje
- Una sola pregunta por mensaje
- Sin bullets ni listas largas
- 1 emoji máximo por mensaje

PROCESO DE VENTA (en orden):
1. Diagnosticar: pregunta qué va a guardar y qué negocio tiene
2. Recomendar: solo neveras técnicamente compatibles con el uso
3. Construir valor: garantía 4 meses, precio vs nueva, remanufactura
4. Objeciones: precio caro → "¿cuánto tiene pensado?" nunca bajar del precio_minimo
5. Escalar SOLO si cliente dice: "cómo pago", "me la llevo", "transferencia"

RAZONAMIENTO TÉCNICO OBLIGATORIO:
Antes de recomendar, verifica que temperatura_min/max del equipo
sea compatible con el uso del cliente:
- Bebidas (cerveza, gaseosa): necesita 2-8°C → solo exhibidoras
- Carnes frescas, pescado: necesita 0-4°C → horizontales o cámaras
- Helados, congelados: necesita -18 a -25°C → solo congeladores
- Lácteos, panadería: necesita 2-6°C → vitrinas refrigeradas
Si ningún equipo es apto: decirlo honestamente, NO inventar.

CAPACIDAD: Si el cliente menciona cantidad (canastas, kilos, litros),
solo recomendar neveras con capacidad_litros suficiente.
10 canastas de cerveza = mínimo 200 litros necesarios.

FOTOS: Si piden foto, responde "Claro, ahorita le mando 📸" e incluye
al final en línea separada: [ENVIAR_FOTO:id_exacto_del_inventario]

ENVÍOS - REGLA ABSOLUTA:
Si preguntan por envío: pregunta la ciudad si no la sabes.
Cuando tengas la ciudad di EXACTAMENTE:
"Déjeme consultar el costo a [ciudad] con el equipo. Le confirmo. ⏳"
NUNCA inventes un precio de envío. JAMÁS.

PRECIO MÍNIMO: Nunca mencionar precio_minimo al cliente.
Puedes ceder hasta ese valor pero sin revelarlo.
Si piden por debajo del mínimo: escalar al vendedor.

PROHIBICIONES:
❌ No inventar precios de envío
❌ No recomendar equipo inadecuado para el uso
❌ No inventar specs que no están en el inventario
❌ No decir "no puedo enviar fotos"
❌ No escribir más de 3 líneas

INVENTARIO HOY (máximo 3 equipos relevantes):
${inventarioFormateado}
${bloqueCorreccion}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...historialFormateado,
      { role: 'user', content: mensajeCliente }
    ];

    return await this.razonar(messages, 0.5, 1400);
  }

  formatearInventario(neveras) {
    const items = Array.isArray(neveras) ? neveras : (neveras?.data || []);
    if (items.length === 0) {
      return 'INVENTARIO: BODEGA EN REABASTECIMIENTO. (Di honestamente: "Ahorita justo estamos esperando camión de bodega, pero si me deja su número lo llamo apenas llegue algo para su negocio")';
    }

    return items.map(n => {
      const precio = n.precio.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      const precioMinimo = (n.precio_minimo !== null && n.precio_minimo !== undefined)
        ? n.precio_minimo.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
        : 'no definido';
      const capacidad = (n.capacidad_litros !== null && n.capacidad_litros !== undefined)
        ? `${n.capacidad_litros}L`
        : 'no especificada';
      const tempMin = (n.temperatura_min !== null && n.temperatura_min !== undefined)
        ? `${n.temperatura_min}°C`
        : 'no definida';
      const tempMax = (n.temperatura_max !== null && n.temperatura_max !== undefined)
        ? `${n.temperatura_max}°C`
        : 'no definida';
      const aptoPara = this.inferirUsos(n.temperatura_min, n.temperatura_max, n.uso_recomendado);
      return [
        `• [ID:${n.id}]`,
        `Equipo: ${n.nombre}`,
        `Tipo: ${n.tipo}`,
        `Precio: $${precio} COP`,
        `Precio mínimo negociable: $${precioMinimo} COP (SOLO INTERNO, NUNCA DECIRLO AL CLIENTE)`,
        `Capacidad: ${capacidad}`,
        `Temperatura de operación: ${tempMin} a ${tempMax}`,
        `Apto para: ${aptoPara}`,
        `Especificaciones: ${n.especificaciones || 'pendiente de confirmar'}`
      ].join(' | ');
    }).join('\n');
  }

  generarUrgencia(inventario) {
    const items = Array.isArray(inventario) ? inventario : (inventario?.data || []);
    if (items.length > 0 && items.length <= 2) {
      return `\n⚠️ URGENCIA REAL: Solo quedan ${items.length} equipo(s) en bodega. Comunícaselo al cliente sin exagerar.`;
    }
    if (items.length <= 5) {
      return `\n📦 STOCK BAJO: Solo ${items.length} equipos disponibles. Puedes mencionar que el stock rota rápido.`;
    }
    return '';
  }
}

module.exports = new SalesAgent();
