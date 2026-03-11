const BaseAgent = require('./BaseAgent');
const cron = require('node-cron');
const telegramMod = require('../telegram'); 

class MarketingAgent extends BaseAgent {
  constructor() {
    super('AgenteMarketing', 'Creador de contenido automatizado. Genera copys persuasivos para Facebook destacando nuestra identidad de marca.');
  }

  iniciarActividadDiaria(dbModule) {
    // Se programa para las 9:00 AM hora de Colombia
    cron.schedule('0 9 * * *', async () => {
      console.log('⏰ [MarketingAgent] Iniciando generación de copys diarios para Facebook...');
      await this.generarPublicaciones(dbModule);
    }, {
      scheduled: true,
      timezone: "America/Bogota"
    });
    console.log('✅ [MarketingAgent] CronJob programado (9:00 AM diarios).');
  }

  async generarPublicaciones(dbModule) {
    try {
      const inventario = await dbModule.obtenerInventarioDisponible();
      const items = Array.isArray(inventario) ? inventario : (inventario?.data || []);
      
      if (items.length === 0) {
        console.log('⚠️ [MarketingAgent] No hay inventario para publicar hoy.');
        return;
      }

      // Tomamos la cantidad deseada (25). Si el stock es menor, repetimos neveras aleatoriamente
      const cantidadDeseada = 25;
      const seleccionadas = [];
      for(let i = 0; i < cantidadDeseada; i++) {
        const randomIndex = Math.floor(Math.random() * items.length);
        seleccionadas.push(items[randomIndex]);
      }

      const bot = telegramMod.obtenerInstanciaBot();
      const superGroupId = process.env.TELEGRAM_OWNER_CHAT_ID;
      
      if (!bot || !superGroupId) {
        console.warn('⚠️ [MarketingAgent] Bot no inicializado o falta TELEGRAM_OWNER_CHAT_ID.');
        return;
      }

      // Creamos un Nuevo Hilo (Topic) diario para las publicaciones
      const fechaHoy = new Date().toLocaleDateString('es-CO');
      const topicName = `📢 Publicaciones Facebook (${fechaHoy})`;
      let threadId = null;

      try {
        const topic = await bot.createForumTopic(superGroupId, topicName);
        threadId = topic.message_thread_id;
        await bot.sendMessage(superGroupId, '¡Hola equipo! 🚀\nAquí les dejo los 5 copys rompedores del día con las fotos ya editadas de la bodega. Solo copien, peguen y posteen en Facebook. 📈', { message_thread_id: threadId });
      } catch (topicError) {
        console.error('Error creando Topic diario:', topicError.message);
        // Si no logra crear el topic (tal vez falta permisos explícitos intermitentes), no bloquea:
      }

      let contador = 1;
      for (const nevera of seleccionadas) {
        const copy = await this.redactarCopyParaRedes(nevera, contador);
        
        const opts = { parse_mode: 'Markdown' };
        if (threadId) {
          opts.message_thread_id = threadId;
        }

        // Si la nevera tiene la foto (idealmente ya subida y mejorada por Photoroom desde Telegram)
        if (nevera.foto_url) {
          await bot.sendPhoto(superGroupId, nevera.foto_url, { ...opts, caption: `[POST #${contador}]\n\n${copy}` });
        } else {
          await bot.sendMessage(superGroupId, `[POST #${contador}]\n\n${copy}`, opts);
        }
        
        // Esperemos unos segundos entre envío para evitar spam limits en la API
        await new Promise(r => setTimeout(r, 2000));
        contador++;
      }
      
      console.log('✅ [MarketingAgent] Publicaciones enviadas al grupo exitosamente.');
    } catch (e) {
      console.error('❌ [MarketingAgent Error]', e);
    }
  }

  async redactarCopyParaRedes(nevera, variacionEstilo) {
    const systemPrompt = `Eres el Community Manager estrella de "Compra Venta Jireh" en Bogotá.
TU OBJETIVO: Escribir un Post/Copy altamente persuasivo para Facebook vendiendo una nevera industrial remanufacturada.

REGLA DE VARIACIÓN #${variacionEstilo}: Como hoy publicarás esta misma nevera varias veces, haz que este copy específico tenga un enfoque único (usa humor, o céntrate 100% en el ahorro, o en urgencia, o en la garantía) para que sea distinto al anterior.

IDENTIDAD DE MARCA:
- Tono: Profesional pero cercano, al estilo del comerciante colombiano trabajador (usa "usted" en vez de "tú").
- Enfoque principal: AHORRO DE DINERO vs comprar nueva (costo/beneficio), CALIDAD en la remanufactura y GARANTÍA B2B.
- Formato: Emojis justos, viñetas claras, y siempre con un Call To Action (Llamado a la acción) al final. Todo debajo de una buena frase de gancho (Hook).

ESTRUCTURA OBLIGATORIA DEL POST:
1. Hook (Gancho) llamativo (Pregunta o solución de dolor). Ej. "¿Buscando equipar su negocio sin descapitalizarse?"
2. Beneficio de Ahorro.
3. Ficha Técnica resumida y Precio.
4. Urgencia/Social Proof ("Nos llegan poquitas de esta").
5. Call to Action ("Escríbanos a nuestro WhatsApp dando clic aquí: [Link]").

TUS DATOS SOBRE LA NEVERA:
- Nombre: ${nevera.nombre}
- Tipo y Capacidad: ${nevera.tipo || 'Industrial'} - ${nevera.capacidad_litros ? nevera.capacidad_litros + 'L' : '?'}
- Atributos Ténicos: ${nevera.especificaciones || 'Reparada y funcionando 10/10'}
- Para qué sirve: Ideal para ${nevera.uso_recomendado || 'comercios'}
- Precio: ${nevera.precio ? '$' + nevera.precio.toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g, '.') + ' COP' : 'A consultar'}

📝 Redacta el Copy listo para Copy-Paste a Facebook (sin comillas de markdown, ni intro tuya).`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Dame el mejor copy para esta nevera.'}
    ];

    try {
      const copy = await this.razonar(messages, 0.7, 400);
      return copy || `✅ Disponible: ${nevera.nombre}\n💰 ${nevera.precio}\nIdeal para ${nevera.uso_recomendado}.\n⚠️ ¡Stock súper limitado! Escríbenos ya al WhatsApp.`;
    } catch(e) {
      console.error('[MarketingAgent] Error devolviendo fallback:', e);
      return `✅ Disponible: ${nevera.nombre}\n💰 ${nevera.precio}\n¡Pregunta ya!`;
    }
  }
}

module.exports = new MarketingAgent();
