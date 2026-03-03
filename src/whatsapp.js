// Módulo para WhatsApp Business Cloud API de Meta
require('dotenv').config();
const axios = require('axios');

// Variables de entorno
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

// 1. Verificar webhook de Meta
function verificarWebhook(req, res) {
  try {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    if (mode && token) {
      if (token === WHATSAPP_VERIFY_TOKEN) {
        console.log('Webhook verificado exitosamente');
        res.send(challenge);
      } else {
        console.log('Token de verificación incorrecto');
        res.sendStatus(403);
      }
    } else {
      res.sendStatus(403);
    }
  } catch (error) {
    console.error('Error al verificar webhook:', error);
    res.sendStatus(500);
  }
}

// 2. Extraer datos del mensaje del webhook
function extraerDatosMensaje(body) {
  try {
    // Verificar estructura básica
    if (!body.entry || !body.entry[0] || !body.entry[0].changes || !body.entry[0].changes[0]) {
      return null;
    }
    
    const value = body.entry[0].changes[0].value;
    
    // Verificar que hay mensajes
    if (!value.messages || !value.messages[0]) {
      return null;
    }
    
    const mensaje = value.messages[0];
    
    // Mensajes no texto (audio, imagen, sticker, etc.)
    if (mensaje.type !== 'text') {
      return {
        telefono: mensaje.from,
        nombre: value.contacts?.[0]?.profile?.name || 'Cliente',
        mensaje: null,
        timestamp: mensaje.timestamp,
        tipoMensaje: mensaje.type
      };
    }
    
    // Extraer datos
    const telefono = mensaje.from;
    const nombre = value.contacts && value.contacts[0] && value.contacts[0].profile 
      ? value.contacts[0].profile.name 
      : 'Cliente';
    const texto = mensaje.text.body;
    const timestamp = mensaje.timestamp;
    
    return {
      telefono,
      nombre,
      mensaje: texto,
      timestamp
    };
  } catch (error) {
    console.error('Error al extraer datos del mensaje:', error);
    return null;
  }
}

// 3. Enviar mensaje de texto
async function enviarMensaje(telefono, texto) {
  try {
    // Limitar longitud del mensaje
    let textoFinal = texto;
    if (texto.length > 4096) {
      textoFinal = texto.substring(0, 4096);
    }
    
    const url = `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`;
    
    const response = await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        to: telefono,
        type: 'text',
        text: {
          body: textoFinal
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return response.data;
  } catch (error) {
    console.error('Error al enviar mensaje de WhatsApp:', error.response?.data || error.message);
    throw error;
  }
}

// 4. Enviar mensaje con imagen
async function enviarMensajeConImagen(telefono, urlImagen, caption) {
  try {
    const url = `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`;
    
    const response = await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        to: telefono,
        type: 'image',
        image: {
          link: urlImagen,
          caption: caption
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return response.data;
  } catch (error) {
    console.error('Error al enviar imagen por WhatsApp:', error.response?.data || error.message);
    throw error;
  }
}

// 5. Enviar lista de neveras
async function enviarListaNeveras(telefono, neveras) {
  try {
    const neverasAMostrar = neveras.slice(0, 3);

    for (let index = 0; index < neverasAMostrar.length; index += 1) {
      const nevera = neverasAMostrar[index];
      const precioFormateado = nevera.precio.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      const emoji = index === 0 ? '1️⃣' : index === 1 ? '2️⃣' : '3️⃣';

      if (nevera.foto_url) {
        const caption = `*${nevera.nombre}*\n💰 $${precioFormateado} COP\n📦 ${nevera.tipo} | ${nevera.capacidad_litros}L\n🏪 Ideal para: ${nevera.uso_recomendado}`;
        await enviarMensajeConImagen(telefono, nevera.foto_url, caption);
        await new Promise((r) => setTimeout(r, 800));
      } else {
        const texto = `${emoji} *${nevera.nombre}*\n💰 $${precioFormateado} COP\n📦 ${nevera.tipo} | ${nevera.capacidad_litros}L`;
        await enviarMensaje(telefono, texto);
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    await new Promise((r) => setTimeout(r, 500));
    return await enviarMensaje(
      telefono,
      '¿Le interesa alguna en particular? Cuéntenos más sobre su negocio para recomendarle la ideal 😊'
    );
  } catch (error) {
    console.error('Error al enviar lista de neveras:', error);
    throw error;
  }
}

// Exportar funciones
module.exports = {
  verificarWebhook,
  extraerDatosMensaje,
  enviarMensaje,
  enviarMensajeConImagen,
  enviarListaNeveras
};
