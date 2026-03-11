const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
require('dotenv').config();

class VisualAgent {
  constructor() {
    this.apiKey = process.env.PHOTOROOM_API_KEY;
  }

  async removerFondo(bufferImagenBinaria) {
    if (!this.apiKey) {
      console.warn('⚠️ [VisualAgent] No hay PHOTOROOM_API_KEY. Devolviendo imagen original sin editar.');
      return bufferImagenBinaria;
    }

    try {
      console.log('🎨 [VisualAgent] Procesando imagen en Photoroom API...');
      
      const form = new FormData();
      // Photoroom espera un archivo multipart
      form.append('image_file', bufferImagenBinaria, {
        filename: 'nevera.jpg',
        contentType: 'image/jpeg',
      });
      // Añadir un fondo blanco limpio o transparente. 
      // Si omitimos bg_color, devuelve PNG transparente. Con bg_color=FFFFFF devuelve un JPEG sólido.
      form.append('bg_color', '#FFFFFF');

      const response = await axios.post('https://sdk.photoroom.com/v1/segment', form, {
        headers: {
          ...form.getHeaders(),
          'x-api-key': this.apiKey,
        },
        responseType: 'arraybuffer', // Queremos la imagen de vuelta como binario
      });

      console.log('✅ [VisualAgent] Fondo removido exitosamente.');
      return Buffer.from(response.data);
    } catch (error) {
      console.error('❌ [VisualAgent Error]', error.message);
      if (error.response) {
         console.error(error.response.data.toString());
      }
      return bufferImagenBinaria; // Si falla, que siga el proceso con la imagen original
    }
  }
}

module.exports = new VisualAgent();
