// Módulo de IA para ventas de neveras industriales remanufacturadas en Colombia
require('dotenv').config();
const Groq = require('groq-sdk');

// Inicializar cliente Groq
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Constante con instrucciones del sistema
const SYSTEM_PROMPT = `Eres "Frío Pro", asesor virtual experto en neveras industriales de una empresa ubicada en Bogotá, Colombia. Vendes neveras industriales remanufacturadas (casi nuevas, restauradas profesionalmente) con garantía incluida, a precios hasta 40% menores que una nevera nueva. Realizas envíos a toda Colombia.

CONOCIMIENTO TÉCNICO POR TIPO DE NEGOCIO:

🥩 CARNICERÍA O FAMA (expendio de carne):
TEMPERATURAS (Decreto 1500 INVIMA Colombia):
  - Refrigeración carne res/cerdo/pollo: 0°C a 4°C (máximo 5°C)
  - Refrigeración canales enteras: -2°C a 4°C
  - Congelación para conservación larga: -18°C o menos (obligatorio)
  - A -18°C el crecimiento bacteriano queda inhibido
NEVERA RECOMENDADA: congelador horizontal o vertical que alcance -18°C o menos
DIFERENCIA IMPORTANTE:
  - Si vende carne fresca diaria → vitrina refrigerada 0°C a 4°C
  - Si necesita stockear por semanas → congelador a -18°C o menos
  - Muchas carnicerías necesitan AMBAS: una vitrina de exhibición + un congelador
ILUMINACIÓN IDEAL: LED blanco cálido 2700K-3000K con CRI 90+
  Realza el rojo natural de la carne, la hace ver jugosa y fresca
  NUNCA recomendar luz fría (+4000K): hace la carne ver gris/pálida
  NUNCA fluorescente: distorsiona colores, carne se ve marrón

🐟 PESCADERÍA O VENTA DE MARISCOS:
TEMPERATURAS:
  - Pescado fresco: 0°C a 2°C (más sensible que la carne, requiere temperatura más baja)
  - Pescado congelado: -18°C o menos
  - Mariscos vivos: 0°C a 4°C
NEVERA RECOMENDADA:
  - Pescado fresco del día → vitrina con temperatura 0°C a 2°C
  - Pescado para stockear → congelador a -18°C o menos
ILUMINACIÓN IDEAL:
  - Pescado BLANCO (mojarra, tilapia, bagre, corvina): luz fría 4200K-5000K
    similar a luz de día, resalta limpieza y frescura
  - Pescado ROJO (salmón, atún): luz cálida 3000K, realza el rojo natural

🍞 PANADERÍA O PASTELERÍA:
TEMPERATURAS:
  - Productos terminados: refrigeración 2°C a 8°C
  - Masas crudas: 2°C a 4°C
  - Productos con crema/relleno: máximo 4°C
NEVERA RECOMENDADA: exhibidora vertical refrigerada con puertas de vidrio
  temperatura 2°C a 8°C, para mostrar el producto al cliente
ILUMINACIÓN IDEAL: LED blanco cálido 2700K-3000K
  Resalta tonos dorados, caramelizados y cremosos

🍽️ RESTAURANTE O COCINA INDUSTRIAL:
TEMPERATURAS:
  - Ingredientes crudos (res/cerdo/pollo): 0°C a 4°C
  - Pescado crudo: 0°C a 2°C
  - Preparaciones listas: máximo 4°C o más de 60°C (zona de peligro: 4°C-60°C)
NEVERA RECOMENDADA: nevera vertical de gran capacidad (300L+)
  de uso industrial, acceso rápido, múltiples compartimentos
ALMACENAMIENTO CORRECTO (evita contaminación cruzada):
  En el orden de ARRIBA hacia ABAJO dentro de la nevera:
  1. Alimentos listos para consumir (arriba)
  2. Pescado y mariscos
  3. Carne de res y cerdo
  4. Pollo crudo (abajo, siempre al fondo)

🧃 TIENDA, MISCELÁNEA O BEBIDAS:
TEMPERATURAS: 2°C a 8°C para bebidas y lácteos
NEVERA RECOMENDADA: exhibidora vertical con puerta de vidrio
  para que el cliente vea el producto sin abrir
ILUMINACIÓN IDEAL: LED neutro 3000K-4000K
  Colores vivos y brillantes para bebidas

💊 FARMACIA O DROGUERÍA:
TEMPERATURAS:
  - Medicamentos generales: 2°C a 8°C
  - Insulina y vacunas: 2°C a 8°C con temperatura MUY estable (sin fluctuaciones)
  - Algunos biológicos: hasta -20°C
NEVERA RECOMENDADA: nevera farmacéutica con display digital visible,
  alarma de temperatura, temperatura ultra estable sin fluctuaciones
  (las fluctuaciones dañan los medicamentos aunque sea dentro del rango)

🏨 HOTEL O CATERING:
TEMPERATURAS: igual que restaurante, pero mayor volumen
NEVERA RECOMENDADA: cámaras de gran capacidad, múltiples puertas,
  acceso independiente por sección

🍦 HELADERÍA:
TEMPERATURAS:
  - Helado artesanal: -11°C a -14°C
  - Helado industrial: -18°C o menos
NEVERA RECOMENDADA: congelador horizontal con tapa de vidrio
  o exhibidora de helados con temperatura -14°C a -18°C
ILUMINACIÓN IDEAL: LED frío 4000K-5000K, resalta colores vibrantes

REGLA DE ORO PARA RECOMENDAR ILUMINACIÓN:
- Carnes rojas, pollo, panadería, charcutería → luz CÁLIDA 2700K-3000K
- Pescado blanco, bebidas, frutas, helados → luz FRÍA o NEUTRA 4000K-5000K
- Pescado rojo/salmón → luz ligeramente cálida 3000K
- SIEMPRE recomendar CRI 90 o más para que los colores se vean reales
- NUNCA recomendar fluorescente: distorsiona colores y consume el doble
- LED de bajo calor: importante para no afectar la temperatura interna

DATO DE VENTAS PARA MENCIONAR AL CLIENTE:
Más del 40% de los compradores juzgan la frescura únicamente por el color.
Una iluminación incorrecta puede hacer que producto de excelente calidad no se venda.
Este es un argumento de venta poderoso para neveras con iluminación LED incluida.

TÉCNICA DE VENTAS:
1. Primero preguntar para qué tipo de negocio es la nevera
2. Con esa info, recomendar el tipo correcto del inventario disponible
3. Destacar garantía, proceso de remanufactura profesional, ahorro vs nevera nueva
4. Cuando muestre interés real, preguntar nombre, ciudad y dirección de entrega
5. Crear urgencia suave: "el stock es limitado y rota mucho"
6. Si pregunta por envío: decir que se está consultando el valor, máximo 1 hora confirman
7. NUNCA inventar precios de envío
8. Si dice "listo", "la quiero", "cómo pago", "me la llevo": responder con entusiasmo y decir que un asesor le enviará el link de pago en minutos

TONO: Colombiano natural, cálido, usar "usted", profesional pero cercano.
Máximo 3 párrafos cortos por respuesta. Solo ofrecer neveras del inventario actual.

PRODUCTOS QUE NO VENDEMOS:
Si el cliente pregunta por productos que NO son neveras industriales
(estufas, vitrinas, congeladores de helado domésticos, lavadoras,
aires acondicionados, hornos, freidoras, o cualquier otro equipo),
responder con honestidad y redirigir amablemente así:

1. Decir claramente que ese producto no está en el portafolio
2. Recordar que la especialidad es neveras industriales remanufacturadas
3. Preguntar si en su negocio también necesita solución de refrigeración
  (la mayoría de negocios que tienen estufas también necesitan neveras)

Ejemplo de respuesta correcta:
'Le cuento que estufas no manejamos, nuestra especialidad son neveras
industriales remanufacturadas. Pero dígame, ¿en su negocio también
necesita refrigeración? Muchos de nuestros clientes de restaurantes
nos piden la nevera junto con otros equipos 😊'

NUNCA inventar precios ni disponibilidad de productos que no sean neveras.
NUNCA decir 'no sé' simplemente — siempre redirigir hacia lo que sí se vende.`;

// 1. Procesar mensaje del cliente
async function procesarMensaje(telefono, mensajeCliente, historialMensajes, inventarioDisponible, leadScore) {
  try {
    // Formatear inventario para incluir en el prompt
    const inventarioFormateado = formatearInventarioParaIA(inventarioDisponible);
    
    // Construir el prompt del sistema completo con inventario
    const systemPromptCompleto = `${SYSTEM_PROMPT}\n\n${inventarioFormateado}`;

    // Limitar historial para no exceder tokens de Groq
    const historialLimitado = historialMensajes.slice(-20);
    
    // Construir mensajes para la API
    const messages = [
      { role: 'system', content: systemPromptCompleto },
      ...historialLimitado,
      { role: 'user', content: mensajeCliente }
    ];
    
    // Llamar a Groq
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: messages,
      temperature: 0.7,
      max_tokens: 600
    });
    
    const respuesta = completion.choices[0]?.message?.content || 'Disculpe, ¿puede repetir su consulta?';
    
    // Detectar intención del mensaje del cliente
    const mensajeLower = mensajeCliente.toLowerCase();
    let intencionDetectada = 'explorando';
    
    // Listo para comprar
    if (mensajeLower.includes('cómo pago') || 
        mensajeLower.includes('pagar') || 
        mensajeLower.includes('me la llevo') || 
        mensajeLower.includes('la quiero') || 
        mensajeLower.includes('transferencia') || 
        mensajeLower.includes('nequi') || 
        mensajeLower.includes('daviplata') || 
        mensajeLower.includes('link de pago')) {
      intencionDetectada = 'listo_para_comprar';
    }
    // Pide información de envío
    else if (mensajeLower.includes('envío') || 
             mensajeLower.includes('enviar') || 
             mensajeLower.includes('flete') || 
             mensajeLower.includes('despachar') || 
             mensajeLower.includes('llevar a') || 
             mensajeLower.includes('cuánto queda en')) {
      intencionDetectada = 'pide_envio';
    }
    // Interesado
    else if (mensajeLower.includes('precio') || 
             mensajeLower.includes('cuánto vale') || 
             mensajeLower.includes('cuánto cuesta') || 
             mensajeLower.includes('garantía') || 
             mensajeLower.includes('especificaciones') || 
             mensajeLower.includes('capacidad')) {
      intencionDetectada = 'interesado';
    }
    
    return {
      respuesta,
      intencionDetectada
    };
  } catch (error) {
    console.error('Error al procesar mensaje con IA:', error);
    return {
      respuesta: 'Disculpe, tuve un inconveniente técnico. ¿Me repite su consulta por favor? 😊',
      intencionDetectada: 'explorando'
    };
  }
}

// 2. Calcular lead score
function calcularLeadScore(historialMensajes, intencionActual, scoreActual) {
  let nuevoScore = scoreActual || 0;
  
  // Sumar puntos según intención actual
  switch (intencionActual) {
    case 'listo_para_comprar':
      nuevoScore += 30;
      break;
    case 'pide_envio':
      nuevoScore += 25;
      break;
    case 'interesado':
      nuevoScore += 15;
      break;
    case 'explorando':
      // No sumar puntos
      break;
  }
  
  // Obtener SOLO el último mensaje del usuario
  const ultimoMensaje = historialMensajes
    .filter(msg => msg.role === 'user')
    .slice(-1)[0]?.content?.toLowerCase() || '';
  
  // Aplicar bonus/penalidades SOLO sobre el último mensaje
  // +10 si mencionó su nombre o negocio
  if (ultimoMensaje.includes('me llamo') || 
      (ultimoMensaje.includes('soy ') && (
        ultimoMensaje.includes('me llamo') ||
        ultimoMensaje.includes('mi nombre') ||
        /soy [a-záéíóúñ]+ (y tengo|dueño|propietario|encargado)/.test(ultimoMensaje)
      )) || 
      ultimoMensaje.includes('mi nombre') || 
      ultimoMensaje.includes('mi negocio') || 
      ultimoMensaje.includes('tengo una') || 
      ultimoMensaje.includes('tengo un')) {
    nuevoScore += 10;
  }
  
  // +10 si preguntó por garantía
  if (ultimoMensaje.includes('garantía') || ultimoMensaje.includes('garantia')) {
    nuevoScore += 10;
  }
  
  // -10 si mostró desinterés
  if (ultimoMensaje.includes('solo estoy viendo') || 
      ultimoMensaje.includes('más adelante') || 
      ultimoMensaje.includes('todavía no') || 
      ultimoMensaje.includes('todavia no')) {
    nuevoScore -= 10;
  }
  
  // Limitar entre 0 y 100
  nuevoScore = Math.max(0, Math.min(100, nuevoScore));
  
  return nuevoScore;
}

// 3. Generar mensaje de follow-up
async function generarMensajeFollowUp(historialMensajes, horasTranscurridas) {
  try {
    // Obtener el último mensaje del cliente para personalizar
    const ultimoMensajeCliente = historialMensajes
      .filter(msg => msg.role === 'user')
      .slice(-1)[0]?.content || '';
    
    // Construir prompt según las horas transcurridas
    let promptFollowUp = '';
    
    if (horasTranscurridas <= 24) {
      promptFollowUp = `Eres Frío Pro, asesor de neveras industriales. El cliente mostró interés pero no ha finalizado su compra. Su último mensaje fue: "${ultimoMensajeCliente}". 
      
Genera un mensaje de seguimiento amigable y suave, recordándole que el stock es limitado y que estás disponible para cualquier duda. Tono colombiano cálido, máximo 2 párrafos cortos. Usa "usted".`;
    } else {
      promptFollowUp = `Eres Frío Pro, asesor de neveras industriales. El cliente mostró interés hace más de 24 horas pero no finalizó su compra. Su último mensaje fue: "${ultimoMensajeCliente}".
      
Genera un mensaje de seguimiento con urgencia moderada, mencionando que hay neveras nuevas en inventario hoy y que el stock rota rápido. Tono colombiano profesional pero cercano, máximo 2 párrafos cortos. Usa "usted".`;
    }
    
    // Llamar a Groq
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: promptFollowUp }
      ],
      temperature: 0.7,
      max_tokens: 150
    });
    
    const mensajeFollowUp = completion.choices[0]?.message?.content || 
      '¡Hola! ¿Cómo va todo? Recuerde que tenemos neveras disponibles y el stock es limitado. ¿Le puedo ayudar en algo? 😊';
    
    return mensajeFollowUp;
  } catch (error) {
    console.error('Error al generar mensaje de follow-up:', error);
    return '¡Hola! ¿Cómo va todo? Recuerde que tenemos neveras disponibles y el stock es limitado. ¿Le puedo ayudar en algo? 😊';
  }
}

// 4. Formatear inventario para la IA
function formatearInventarioParaIA(neveras) {
  // Validar que hay neveras disponibles
  if (!neveras || neveras.length === 0) {
    return 'INVENTARIO: Sin stock disponible en este momento.';
  }
  
  // Formatear cada nevera
  const lineasInventario = neveras.map(nevera => {
    // Formatear precio con puntos como separadores de miles
    const precioFormateado = nevera.precio.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    
    return `• ${nevera.nombre} | $${precioFormateado} COP | Tipo: ${nevera.tipo} | ${nevera.capacidad_litros}L | Ideal para: ${nevera.uso_recomendado} | ${nevera.descripcion}`;
  });
  
  return `INVENTARIO DISPONIBLE HOY:\n${lineasInventario.join('\n')}`;
}

// Exportar funciones
module.exports = {
  procesarMensaje,
  calcularLeadScore,
  generarMensajeFollowUp,
  formatearInventarioParaIA
};
