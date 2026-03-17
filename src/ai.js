// Módulo de IA para ventas de neveras industriales remanufacturadas en Colombia
require('dotenv').config();
const Groq = require('groq-sdk');

// Inicializar cliente Groq
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const Orchestrator = require('./agents/Orchestrator');
// 1. Procesar mensaje del cliente (Ahora delegado al Orchestrator Multi-Agente)
async function procesarMensaje(telefono, mensajeCliente, historialMensajes, inventarioDisponible, leadScore, dbInsights = '') {
  try {
    // El orquestador toma el control completo:
    const resultado = await Orchestrator.procesarMensaje(
      telefono,
      mensajeCliente,
      historialMensajes,
      inventarioDisponible,
      leadScore,
      dbInsights
    );

    return resultado;
  } catch (error) {
    console.error('Error al procesar mensaje con la Orquestación de IA:', error);
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
    case 'cierre':           // El Orchestrator retorna 'cierre' cuando el cliente quiere pagar
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
    // Extraer contexto usando los últimos mensajes
    const conversacionTexto = historialMensajes.slice(-8).map(m => `${m.role === 'user' ? 'Cliente' : 'Agente'}: ${m.content}`).join('\n');
    
    // Construir prompt según las horas transcurridas
    let promptFollowUp = '';
    
    if (horasTranscurridas <= 24) {
      promptFollowUp = `Eres Compra Venta Jireh, asesor de neveras industriales. El cliente mostró interés pero no ha finalizado su compra.
      
Historial de conversación:
${conversacionTexto}

Instrucciones:
Genera un mensaje de seguimiento amigable y corto (máx 2 párrafos).
1. Personaliza el mensaje según el tipo de negocio del cliente si se mencionó.
2. Si el cliente mencionó una nevera específica, haz alusión a ella.
3. Recuerda que el stock es limitado. Tono colombiano cálido, usa "usted".`;
    } else if (horasTranscurridas <= 48) {
      promptFollowUp = `Eres Compra Venta Jireh, asesor de neveras industriales. El cliente mostró interés hace más de 24 horas.
      
Historial de conversación:
${conversacionTexto}

Instrucciones:
Genera un mensaje de seguimiento con urgencia moderada (máx 2 párrafos).
1. Personaliza el mensaje según el tipo de negocio del cliente si se mencionó.
2. Si le interesó una nevera en particular, menciónala.
3. Menciona que el stock rota rápido. Tono colombiano cercano, usa "usted".`;
    } else {
      promptFollowUp = `Eres Compra Venta Jireh, asesor de neveras industriales. Han pasado 72 horas y el cliente tiene alto interés.
      
Historial de conversación:
${conversacionTexto}

Instrucciones:
Genera un último mensaje de seguimiento muy persuasivo y resolutivo (máx 2 párrafos).
1. Personaliza el mensaje según el tipo de negocio del cliente si se mencionó.
2. Si el cliente tiene una nevera en mira, menciónala.
3. Pregunta si tiene alguna duda final y ponte a disposición. Tono colombiano experto y empatíco, usa "usted".`;
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
