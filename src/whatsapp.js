// Módulo para WhatsApp vía Twilio
require('dotenv').config();
const twilio = require('twilio');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const TWILIO_FROM = process.env.TWILIO_WHATSAPP_FROM
  || 'whatsapp:+14155238886';

const verificarWebhook = (req, res) => {
  // Twilio no necesita verificación de webhook
  res.sendStatus(200);
};

const extraerDatosMensaje = (body) => {
  try {
    const telefono = (body.From || '').replace('whatsapp:', '');
    const mensaje  = body.Body || '';
    const nombre   = body.ProfileName || 'Cliente';
    const mediaUrl = body.MediaUrl0 || null;
    const mediaType= body.MediaContentType0 || null;

    if (!telefono || !mensaje) return null;

    return {
      telefono,
      mensaje,
      nombre,
      mediaUrl,
      mediaType,
      esAudio: mediaType && mediaType.includes('audio'),
      esImagen: mediaType && mediaType.includes('image')
    };
  } catch (error) {
    console.error('Error extrayendo datos:', error);
    return null;
  }
};

const enviarMensaje = async (telefono, texto) => {
  try {
    const to = telefono.startsWith('whatsapp:')
      ? telefono
      : `whatsapp:${telefono}`;

    await client.messages.create({
      from: TWILIO_FROM,
      to:   to,
      body: texto
    });
  } catch (error) {
    console.error('Error enviando mensaje Twilio:', error);
  }
};

const enviarMensajeConImagen = async (telefono, texto, imagenUrl) => {
  try {
    const to = telefono.startsWith('whatsapp:')
      ? telefono
      : `whatsapp:${telefono}`;

    await client.messages.create({
      from:     TWILIO_FROM,
      to:       to,
      body:     texto,
      mediaUrl: [imagenUrl]
    });
  } catch (error) {
    console.error('Error enviando imagen Twilio:', error);
  }
};

module.exports = {
  verificarWebhook,
  extraerDatosMensaje,
  enviarMensaje,
  enviarMensajeConImagen
};
