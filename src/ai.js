// Módulo de IA para ventas de neveras industriales remanufacturadas en Colombia
require('dotenv').config();
const Groq = require('groq-sdk');

// Inicializar cliente Groq
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Constante con instrucciones del sistema
const SYSTEM_PROMPT = `Eres Juan, asesor de ventas de Compra Venta Jireh,
una empresa bogotana que vende neveras industriales
remanufacturadas con garantía.

TU PERSONALIDAD:
- Hablas como un vendedor colombiano de confianza
- Cálido, cercano, como si le aconsejaras a un amigo
- Nunca sonas como robot ni como manual técnico
- Usas términos colombianos naturales: "claro que sí",
  "con mucho gusto", "le cuento", "mire", "no se preocupe"
- Eres honesto: si no sabes algo, lo dices

TU FORMA DE ESCRIBIR EN WHATSAPP:
- Máximo 3 líneas por párrafo
- Usa saltos de línea entre ideas
- Nunca escribas un bloque de texto de más de 4 líneas seguidas
- Usa esto para énfasis: *texto en negrita*
- Listas con guión: - item
- Máximo 2 emojis por mensaje, solo si aportan
- Nunca uses lenguaje corporativo ni palabras como
  "asimismo", "por ende", "cabe destacar"

LO QUE VENDES:
- Neveras industriales remanufacturadas
- Tipos: horizontales, verticales, exhibidoras, congeladores
- Precios: desde $1.000.000 COP
- Garantía incluida en todas
- Envíos a toda Colombia desde Bogotá
- Ahorro: hasta 40% vs nevera nueva

REGLAS IMPORTANTES:
- Si el cliente pregunta por precio, da un rango y
  ofrece cotización personalizada por WhatsApp
- Si el cliente duda, cuéntale del proceso de
  remanufactura y la garantía - eso genera confianza
- Siempre termina con una pregunta o invitación
  a seguir hablando
- Nunca inventes precios exactos - di "desde X"
  o "depende del modelo"
- Si el cliente está listo para comprar, pídele
  que confirme ciudad para coordinar el envío
- Responde SIEMPRE en español colombiano`;

// 1. Procesar mensaje del cliente
async function procesarMensaje(telefono, mensajeCliente, contextoInventario = '', historialMensajes, inventarioDisponible, leadScore) {
  try {
    // Formatear inventario para incluir en el prompt
    const inventarioFormateado = formatearInventarioParaIA(inventarioDisponible);
    
    // Construir el prompt del sistema completo con inventario
    const systemPrompt = `${SYSTEM_PROMPT}\n\n${inventarioFormateado}

    REGLAS CRITICAS SOBRE EL INVENTARIO:
    1. NUNCA digas que tienes algo que no esta en el inventario
    2. Si el inventario dice "No hay neveras disponibles",
      dile al cliente honestamente que estas sin stock
      en este momento y que puede dejar sus datos para
      avisarle cuando llegue
    3. Si el cliente pide medidas especificas (alto, ancho,
      fondo) y no tienes una que coincida exactamente,
      diselo y ofrece la mas cercana que SI tienes
    4. Nunca inventes precios, capacidades ni medidas
    5. Si no hay stock, no ofrezcas nada - se honesto
    6. Solo recomienda neveras que aparezcan en el
      inventario actual
    7. Si el inventario esta vacio, di algo como:
      "Ahorita no tenemos stock disponible, pero
      constantemente nos llegan equipos nuevos.
      ¿Le puedo anotar para avisarle?"`;
    const systemPromptCompleto = systemPrompt +
      '\n\n' + (contextoInventario || '');

    // Limitar y limpiar historial para no exceder tokens de Groq
    const historialLimpio = (historialMensajes || [])
      .slice(-20)
      .filter(m => m && m.role && m.content);
    
    // Construir mensajes para la API
    const messages = [
      { role: 'system', content: systemPromptCompleto },
      ...historialLimpio,
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
      promptFollowUp = `Eres Compra Venta Jireh, asesor de neveras industriales. El cliente mostró interés pero no ha finalizado su compra. Su último mensaje fue: "${ultimoMensajeCliente}". 
      
Genera un mensaje de seguimiento amigable y suave, recordándole que el stock es limitado y que estás disponible para cualquier duda. Tono colombiano cálido, máximo 2 párrafos cortos. Usa "usted".`;
    } else {
      promptFollowUp = `Eres Compra Venta Jireh, asesor de neveras industriales. El cliente mostró interés hace más de 24 horas pero no finalizó su compra. Su último mensaje fue: "${ultimoMensajeCliente}".
      
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
  // Normalizar: extraer .data si viene envuelto en objeto Supabase
  const items = Array.isArray(neveras)
    ? neveras
    : (neveras?.data && Array.isArray(neveras.data))
      ? neveras.data
      : [];

  if (items.length === 0) {
    return 'INVENTARIO ACTUAL: No hay neveras disponibles en este momento.';
  }
  
  // Formatear cada nevera
  const lineasInventario = items.map(nevera => {
    // Formatear precio con puntos como separadores de miles
    const precioFormateado = nevera.precio.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    
    return `• ${nevera.nombre} | $${precioFormateado} COP | Tipo: ${nevera.tipo} | ${nevera.capacidad_litros}L | Ideal para: ${nevera.uso_recomendado} | ${nevera.descripcion}`;
  });
  
  return `INVENTARIO DISPONIBLE HOY:\n${lineasInventario.join('\n')}`;
}

const transcribirAudio = async (audioUrl) => {
  try {
    // Descargar el audio desde Twilio
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken  = process.env.TWILIO_AUTH_TOKEN;

    const response = await fetch(audioUrl, {
      headers: {
        'Authorization': 'Basic ' +
          Buffer.from(`${accountSid}:${authToken}`).toString('base64')
      }
    });

    if (!response.ok) throw new Error('No se pudo descargar el audio');

    const audioBuffer = await response.arrayBuffer();
    const audioBytes  = Buffer.from(audioBuffer);

    // Usar Groq Whisper para transcribir
    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', audioBytes, {
      filename: 'audio.ogg',
      contentType: 'audio/ogg'
    });
    form.append('model', 'whisper-large-v3');
    form.append('language', 'es');

    const transcripcion = await fetch(
      'https://api.groq.com/openai/v1/audio/transcriptions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          ...form.getHeaders()
        },
        body: form
      }
    );

    const resultado = await transcripcion.json();
    return resultado.text || null;

  } catch (error) {
    console.error('Error transcribiendo audio:', error);
    return null;
  }
};

// Exportar funciones
module.exports = {
  procesarMensaje,
  calcularLeadScore,
  generarMensajeFollowUp,
  formatearInventarioParaIA,
  transcribirAudio
};
