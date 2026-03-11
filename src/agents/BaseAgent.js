const Groq = require('groq-sdk');
require('dotenv').config();

class BaseAgent {
  constructor(nombre, descripcion) {
    this.nombre = nombre;
    this.descripcion = descripcion;
    this.groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    this.modelo = 'llama-3.3-70b-versatile'; // Modelo principal
  }

  async razonar(messages, temperature = 0.7, max_tokens = 800) {
    try {
      const completion = await this.groq.chat.completions.create({
        model: this.modelo,
        messages: messages,
        temperature: temperature,
        max_tokens: max_tokens
      });
      return completion.choices[0]?.message?.content || null;
    } catch (error) {
      console.error(`[${this.nombre} Error]`, error);
      return null;
    }
  }

  formatearHistorial(historialMensajes, limite = 15) {
    return (historialMensajes || [])
      .slice(-limite)
      .map(m => ({
        role: m.role || 'user',
        content: m.content || ''
      }))
      .filter(m => m.content !== '');
  }
}

module.exports = BaseAgent;
