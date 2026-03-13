const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

class VisualAgent {
  constructor() {
    this.apiKey = process.env.REMOVEBG_API_KEY;
  }

  async removerFondo(bufferImagenBinaria) {
    if (!this.apiKey) {
      console.log('[VisualAgent] No hay REMOVEBG_API_KEY. Devolviendo imagen original sin editar.');
      return bufferImagenBinaria;
    }

    try {
      console.log('[VisualAgent] Procesando imagen en Remove.bg API...');

      const form = new FormData();
      form.append('image_file', bufferImagenBinaria, {
        filename: 'nevera.jpg',
        contentType: 'image/jpeg'
      });
      form.append('bg_color', 'FFFFFF');
      form.append('size', 'auto');

      const response = await axios.post('https://api.remove.bg/v1.0/removebg', form, {
        headers: {
          ...form.getHeaders(),
          'X-Api-Key': this.apiKey
        },
        responseType: 'arraybuffer'
      });

      console.log('[VisualAgent] Fondo removido exitosamente con Remove.bg.');
      return Buffer.from(response.data);
    } catch (error) {
      console.error('[VisualAgent Error] Fallo Remove.bg:', error.message);
      if (error.response?.data) {
        try {
          console.error('[VisualAgent Error] Detalle API:', Buffer.from(error.response.data).toString());
        } catch (e) {
          console.error('[VisualAgent Error] No se pudo decodificar detalle de error.');
        }
      }
      return bufferImagenBinaria;
    }
  }
}

module.exports = new VisualAgent();
