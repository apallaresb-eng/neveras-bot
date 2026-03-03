const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const Groq = require('groq-sdk');
const fs = require('fs');
const path = require('path');
const whatsappMod = require('./whatsapp');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

let botInstance = null;
const estadosConversacion = new Map();
const relayActivo = new Map();

function formatearPrecio(precio) {
	if (precio === null || precio === undefined || Number.isNaN(Number(precio))) {
		return 'No detectado';
	}

	return Number(precio).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

async function subirFotoASupabase(bot, fileId) {
	try {
		const file = await bot.getFile(fileId);
		const telegramFileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

		const response = await axios.get(telegramFileUrl, { responseType: 'arraybuffer' });
		const buffer = Buffer.from(response.data);

		const nombreArchivo = `nevera_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;

		const { error } = await supabase.storage
			.from('neveras-fotos')
			.upload(nombreArchivo, buffer, { contentType: 'image/jpeg', upsert: false });

		if (error) throw error;

		const { data: urlData } = supabase.storage.from('neveras-fotos').getPublicUrl(nombreArchivo);

		return {
			url: urlData.publicUrl,
			nombreArchivo
		};
	} catch (error) {
		console.error('Error al subir foto a Supabase:', error);
		return null;
	}
}

async function eliminarFotoDeSupabase(fotoUrl) {
	try {
		if (!fotoUrl) return false;

		const nombreArchivo = String(fotoUrl).includes('neveras-fotos/')
			? String(fotoUrl).split('neveras-fotos/').pop()
			: String(fotoUrl);

		const { error } = await supabase.storage.from('neveras-fotos').remove([nombreArchivo]);

		if (error) throw error;
		return true;
	} catch (error) {
		console.error('Error al eliminar foto de Supabase:', error);
		return false;
	}
}

async function transcribirAudio(bot, fileId) {
	let tempPath = null;

	try {
		const file = await bot.getFile(fileId);
		const audioUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

		const response = await axios.get(audioUrl, { responseType: 'arraybuffer' });
		const buffer = Buffer.from(response.data);

		tempPath = path.join(__dirname, `temp_audio_${Date.now()}.ogg`);
		fs.writeFileSync(tempPath, buffer);

		const transcripcion = await groq.audio.transcriptions.create({
			file: fs.createReadStream(tempPath),
			model: 'whisper-large-v3',
			language: 'es',
			response_format: 'text'
		});

		fs.unlinkSync(tempPath);
		tempPath = null;

		return transcripcion;
	} catch (error) {
		if (tempPath && fs.existsSync(tempPath)) {
			fs.unlinkSync(tempPath);
		}

		console.error('Error al transcribir audio:', error);
		return null;
	}
}

async function estructurarDescripcionConIA(textoLibre) {
	try {
		const completion = await groq.chat.completions.create({
			model: 'llama-3.3-70b-versatile',
			temperature: 0.1,
			max_tokens: 400,
			messages: [
				{
					role: 'system',
					content: `Eres un asistente que extrae información de neveras industriales.
A partir de una descripción libre en español colombiano, extrae los campos
y responde ÚNICAMENTE con un JSON válido con esta estructura exacta:
{
	"nombre": "nombre comercial de la nevera",
	"descripcion": "descripción atractiva de 1-2 oraciones para mostrar al cliente",
	"especificaciones": "specs técnicas: voltaje, gas refrigerante, compresor, temperatura, etc",
	"precio": número sin puntos ni comas (solo dígitos),
	"tipo": "horizontal" | "vertical" | "exhibidora" | "congelador",
	"uso_recomendado": "tipo de negocio ideal",
	"capacidad_litros": número entero
}
Si no puedes determinar algún campo con certeza, usa null.
No incluyas texto antes ni después del JSON.
El precio debe ser un número entero en pesos colombianos.`
				},
				{
					role: 'user',
					content: `Extrae la información de esta nevera: "${textoLibre}"`
				}
			]
		});

		const textoRespuesta = completion.choices[0]?.message?.content || '';
		const jsonLimpio = textoRespuesta.replace(/```json|```/g, '').trim();
		const datosEstructurados = JSON.parse(jsonLimpio);

		return datosEstructurados;
	} catch (error) {
		console.error('Error al estructurar descripción con IA:', error);
		return null;
	}
}

async function iniciarBot(dbModule) {
	botInstance = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

	const esDueno = (chatId) => String(chatId) === String(process.env.TELEGRAM_OWNER_CHAT_ID);
	const esVendedor = (id) => {
		const todos = [
			process.env.TELEGRAM_OWNER_CHAT_ID,
			...(process.env.TELEGRAM_VENDEDORES_IDS || '').split(',').map((x) => x.trim()).filter(Boolean)
		];
		return todos.includes(String(id));
	};

	async function procesarDescripcionLibre(chatId, textoLibre) {
		const datosIA = await estructurarDescripcionConIA(textoLibre);

		if (!datosIA) {
			await botInstance.sendMessage(chatId, '❌ No pude entender la descripción. Intenta de nuevo con más detalles.');
			return;
		}

		const estado = estadosConversacion.get(chatId);
		if (!estado) return;

		estado.datos = {
			...estado.datos,
			...datosIA,
			usoRecomendado: datosIA.uso_recomendado,
			capacidadLitros: datosIA.capacidad_litros
		};
		estado.paso = 'esperando_confirmacion';
		estadosConversacion.set(chatId, estado);

		const precioFormateado = datosIA.precio ? formatearPrecio(datosIA.precio) : 'No detectado';

		const resumen =
			`🤖 *La IA estructuró la información así:*\n\n` +
			`📌 *Nombre:* ${datosIA.nombre || '❓ No detectado'}\n` +
			`📝 *Descripción:* ${datosIA.descripcion || '❓ No detectado'}\n` +
			`⚙️ *Especificaciones:* ${datosIA.especificaciones || '❓ No detectado'}\n` +
			`💰 *Precio:* $${precioFormateado} COP\n` +
			`📦 *Tipo:* ${datosIA.tipo || '❓ No detectado'}\n` +
			`🏪 *Ideal para:* ${datosIA.uso_recomendado || '❓ No detectado'}\n` +
			`📐 *Capacidad:* ${datosIA.capacidad_litros ? `${datosIA.capacidad_litros}L` : '❓ No detectado'}\n` +
			`🖼️ *Foto:* ✅ Guardada\n\n` +
			`¿Todo correcto?\n✅ *SÍ* para guardar al inventario\n❌ *NO* para cancelar`;

		await botInstance.sendMessage(chatId, resumen, { parse_mode: 'Markdown' });
	}

	async function guardarNeveraEnBD(chatId) {
		const estado = estadosConversacion.get(chatId);
		if (!estado) return;

		const resultado = await dbModule.guardarNevera({
			nombre: estado.datos.nombre,
			descripcion: estado.datos.descripcion,
			especificaciones: estado.datos.especificaciones,
			precio: estado.datos.precio,
			tipo: estado.datos.tipo,
			capacidad_litros: estado.datos.capacidadLitros,
			uso_recomendado: estado.datos.usoRecomendado,
			foto_url: estado.datos.fotoUrl
		});

		estadosConversacion.delete(chatId);

		if (resultado) {
			await botInstance.sendMessage(
				chatId,
				'✅ *¡Nevera agregada al inventario exitosamente!* 🎉\n\nLos clientes de WhatsApp ya pueden verla.\nEnvía otra foto para agregar más neveras.',
				{ parse_mode: 'Markdown' }
			);
			return;
		}

		await botInstance.sendMessage(
			chatId,
			'❌ Error al guardar. La foto está en el servidor. Intenta de nuevo enviando la foto.'
		);
	}

	botInstance.on('photo', async (msg) => {
		const chatId = msg.chat.id;

		if (!esDueno(chatId)) {
			await botInstance.sendMessage(chatId, '⛔ No tienes permiso.');
			return;
		}

		if (estadosConversacion.has(chatId)) {
			await botInstance.sendMessage(
				chatId,
				'⚠️ Ya hay una nevera en proceso. Confirma o cancela antes de agregar otra.'
			);
			return;
		}

		await botInstance.sendMessage(chatId, '⏳ Subiendo foto al servidor...');

		const fileId = msg.photo[msg.photo.length - 1].file_id;
		const resultado = await subirFotoASupabase(botInstance, fileId);

		if (!resultado) {
			await botInstance.sendMessage(chatId, '❌ Error al subir la foto. Intenta de nuevo.');
			return;
		}

		estadosConversacion.set(chatId, {
			paso: 'esperando_descripcion',
			datos: {
				fotoUrl: resultado.url,
				nombreArchivo: resultado.nombreArchivo,
				nombre: null,
				descripcion: null,
				especificaciones: null,
				precio: null,
				tipo: null,
				usoRecomendado: null,
				capacidadLitros: null
			}
		});

		await botInstance.sendMessage(
			chatId,
			'✅ *¡Foto guardada!*\n\nAhora descríbeme la nevera como quieras.\n\nPuedes *enviar un audio* hablando o *escribir un texto*. No hay formato fijo, habla natural:\n\n_Ejemplo: "Esta es una horizontal Haceb de 400 litros, compresor nuevo, congela a -20 grados, sirve para carnicería, vale tres millones ochocientos"_',
			{ parse_mode: 'Markdown' }
		);
	});

	botInstance.on('voice', async (msg) => {
		const chatId = msg.chat.id;

		if (!esDueno(chatId)) return;

		const estado = estadosConversacion.get(chatId);
		if (!estado || estado.paso !== 'esperando_descripcion') return;

		await botInstance.sendMessage(chatId, '🎙️ Transcribiendo audio...');

		const transcripcion = await transcribirAudio(botInstance, msg.voice.file_id);

		if (!transcripcion) {
			await botInstance.sendMessage(
				chatId,
				'❌ No pude transcribir el audio. Intenta de nuevo o escribe la descripción.'
			);
			return;
		}

		await botInstance.sendMessage(
			chatId,
			`📝 *Entendí esto:*\n"${transcripcion}"\n\n⏳ Procesando...`,
			{ parse_mode: 'Markdown' }
		);

		await procesarDescripcionLibre(chatId, transcripcion);
	});

	botInstance.on('message', async (msg) => {
		if (!msg.text) return;

		const esVendedorConRelay = relayActivo.has(String(msg.chat.id)) &&
			esVendedor(msg.chat.id) &&
			msg.text &&
			!msg.text.startsWith('/');

		if (esVendedorConRelay) {
			const telefonoCliente = relayActivo.get(String(msg.chat.id));
			await whatsappMod.enviarMensaje(telefonoCliente, msg.text);
			await botInstance.sendMessage(msg.chat.id, '✅ Enviado al cliente', { reply_to_message_id: msg.message_id });

			const conv = await dbModule.obtenerConversacionPorTelefono(telefonoCliente);
			if (conv) {
				const nuevoHistorial = [...(conv.mensajes || []), { role: 'assistant', content: msg.text, tipo: 'vendedor' }];
				await dbModule.actualizarConversacion(conv.id, nuevoHistorial, conv.lead_score, conv.estado);
			}
			return;
		}

		if (msg.text.startsWith('/')) return;

		const chatId = msg.chat.id;
		if (!esDueno(chatId)) return;

		const texto = msg.text.trim();
		if (!estadosConversacion.has(chatId)) return;

		const estado = estadosConversacion.get(chatId);

		if (estado.paso === 'esperando_descripcion') {
			await botInstance.sendMessage(chatId, '⏳ Procesando descripción con IA...');
			await procesarDescripcionLibre(chatId, texto);
			return;
		}

		if (estado.paso === 'esperando_confirmacion') {
			const respuesta = texto.toLowerCase();

			if (respuesta.includes('si') || respuesta.includes('sí')) {
				await guardarNeveraEnBD(chatId);
				return;
			}

			if (respuesta.includes('no')) {
				await eliminarFotoDeSupabase(estado.datos.nombreArchivo);
				estadosConversacion.delete(chatId);
				await botInstance.sendMessage(
					chatId,
					'❌ Cancelado. La foto fue eliminada.\nEnvía una nueva foto cuando quieras.'
				);
				return;
			}

			await botInstance.sendMessage(chatId, '⚠️ Responde *SÍ* para guardar o *NO* para cancelar.', {
				parse_mode: 'Markdown'
			});
		}
	});

	botInstance.onText(/^\/inventario$/, async (msg) => {
		const chatId = msg.chat.id;

		if (!esDueno(chatId)) {
			await botInstance.sendMessage(chatId, '⛔ No tienes permiso.');
			return;
		}

		const neveras = await dbModule.obtenerInventarioDisponible();

		if (!neveras || neveras.length === 0) {
			await botInstance.sendMessage(chatId, '📦 No hay neveras disponibles.');
			return;
		}

		const listado = neveras.slice(0, 10).map((n) => {
			const idCorto = String(n.id).substring(0, 8);
			return `🆔 ${idCorto} | ${n.nombre} | $${formatearPrecio(n.precio)} | ${n.tipo} | ${n.capacidad_litros}L`;
		}).join('\n');

		await botInstance.sendMessage(chatId, `${listado}\n\n💡 Para eliminar: /eliminar [id]`, {
			parse_mode: 'Markdown'
		});
	});

	botInstance.onText(/^\/eliminar(?:\s+(.+))?$/, async (msg, match) => {
		const chatId = msg.chat.id;

		if (!esDueno(chatId)) {
			await botInstance.sendMessage(chatId, '⛔ No tienes permiso.');
			return;
		}

		const idCorto = match && match[1] ? match[1].trim() : '';

		if (!idCorto) {
			await botInstance.sendMessage(
				chatId,
				'⚠️ Uso: /eliminar [id]\nEjemplo: /eliminar abc12345'
			);
			return;
		}

		const neveras = await dbModule.obtenerInventarioDisponible();
		const nevera = (neveras || []).find((n) => String(n.id).startsWith(idCorto));

		if (!nevera) {
			await botInstance.sendMessage(chatId, '❌ No se encontró nevera con ese ID.');
			return;
		}

		await dbModule.marcarNeveraNoDisponible(nevera.id);
		await eliminarFotoDeSupabase(nevera.foto_url);

		await botInstance.sendMessage(
			chatId,
			`✅ *${nevera.nombre}* marcada como vendida y eliminada del inventario. 🎉`,
			{ parse_mode: 'Markdown' }
		);
	});

	botInstance.onText(/^\/estadisticas$/, async (msg) => {
		const chatId = msg.chat.id;

		if (!esDueno(chatId)) {
			await botInstance.sendMessage(chatId, '⛔ No tienes permiso.');
			return;
		}

		const stats = await dbModule.obtenerEstadisticas();
		if (!stats) {
			await botInstance.sendMessage(chatId, '❌ No fue posible obtener estadísticas en este momento.');
			return;
		}

		const mensaje =
			'📊 *Estadísticas*\n\n' +
			`🛒 Ventas este mes: ${stats.totalVentasMes}\n` +
			`🤖 Cerradas por bot: ${stats.ventasBot}\n` +
			`👤 Por vendedor: ${stats.ventasVendedor}\n` +
			`💬 Conversaciones activas: ${stats.conversacionesActivas}\n` +
			`🔥 Leads escalados: ${stats.conversacionesEscaladas}\n` +
			`📈 Score promedio: ${stats.scorePromedio}/100`;

		await botInstance.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
	});

	botInstance.onText(/^\/envio(?:\s+(.+))?$/, async (msg, match) => {
		const chatId = msg.chat.id;

		if (!esDueno(chatId)) {
			await botInstance.sendMessage(chatId, '⛔ No tienes permiso.');
			return;
		}

		const partes = match && match[1] ? match[1].trim().split(/\s+/) : [];
		const cotizacionId = partes[0];
		const precioEnvio = partes[1] ? parseFloat(partes[1]) : null;

		if (!cotizacionId || !precioEnvio || Number.isNaN(precioEnvio)) {
			await botInstance.sendMessage(
				chatId,
				'⚠️ Formato incorrecto.\nUso: /envio [id] [precio]\nEjemplo: /envio abc12345 95000'
			);
			return;
		}

		try {
			await dbModule.responderCotizacionEnvio(cotizacionId, precioEnvio);
			const cotizacion = await dbModule.obtenerCotizacionPendiente(cotizacionId);

			if (!cotizacion) {
				await botInstance.sendMessage(chatId, '❌ No se encontró esa cotización.');
				return;
			}

			const telefonoCliente = cotizacion.conversaciones?.telefono;
			if (!telefonoCliente) {
				await botInstance.sendMessage(chatId, '❌ No se encontró el teléfono del cliente.');
				return;
			}

			const precioFormateado = precioEnvio.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

			await whatsappMod.enviarMensaje(
				telefonoCliente,
				`✅ *Información de envío confirmada*\n\nEl envío a ${cotizacion.ciudad_destino} tiene un costo de *$${precioFormateado} COP*.\n\n¿Desea proceder con la compra? 😊`
			);

			await botInstance.sendMessage(chatId, '✅ Precio de envío enviado al cliente exitosamente.');
		} catch (error) {
			console.error('Error al procesar cotización de envío:', error);
			await botInstance.sendMessage(chatId, '❌ Error al procesar la cotización. Intenta de nuevo.');
		}
	});

	botInstance.onText(/^\/tomar(?:\s+(.+))?$/, async (msg, match) => {
		const chatId = msg.chat.id;
		if (!esVendedor(chatId)) return;

		const telefonoCliente = match && match[1] ? match[1].trim().replace(/\D/g, '') : null;
		if (!telefonoCliente) {
			await botInstance.sendMessage(
				chatId,
				'⚠️ Uso: /tomar [telefono]\nEjemplo: /tomar 573001234567'
			);
			return;
		}

		const conversacion = await dbModule.obtenerConversacionPorTelefono(telefonoCliente);
		if (!conversacion) {
			await botInstance.sendMessage(chatId, '❌ No se encontró conversación activa para ese número.');
			return;
		}

		const asignado = await dbModule.asignarVendedor(conversacion.id, msg.chat.id);
		if (asignado === false) {
			await botInstance.sendMessage(chatId, '⚠️ Ese lead ya fue tomado por otro vendedor.');
			return;
		}

		relayActivo.set(String(msg.chat.id), telefonoCliente);

		await botInstance.sendMessage(
			chatId,
			`✅ *Lead tomado exitosamente*\n\n📱 Cliente: +${telefonoCliente}\n💬 Ahora todo lo que escribas aquí llegará al cliente por WhatsApp.\n\n*Comandos disponibles:*\n/cerrar - Marcar venta como cerrada\n/liberar - Devolver lead al bot\n/historial - Ver conversación anterior\n/pausa - Bot no responde pero tú tampoco (cliente en espera)`,
			{ parse_mode: 'Markdown' }
		);
	});

	botInstance.onText(/^\/cerrar$/, async (msg) => {
		const chatId = msg.chat.id;
		if (!esVendedor(chatId)) return;

		const telefonoCliente = relayActivo.get(String(msg.chat.id));
		if (!telefonoCliente) {
			await botInstance.sendMessage(chatId, '⚠️ No tienes ningún lead activo. Usa /tomar primero.');
			return;
		}

		const conversacion = await dbModule.obtenerConversacionPorTelefono(telefonoCliente);
		if (conversacion) {
			await dbModule.actualizarConversacion(
				conversacion.id,
				conversacion.mensajes,
				conversacion.lead_score,
				'cerrado'
			);
		}

		relayActivo.delete(String(msg.chat.id));
		await botInstance.sendMessage(chatId, '✅ Venta marcada como cerrada. ¡Excelente trabajo! 🎉');

		await whatsappMod.enviarMensaje(
			telefonoCliente,
			'¡Muchas gracias por su compra! 🎉❄️\nFue un placer atenderle.\nCualquier duda adicional, estamos a sus órdenes.'
		);
	});

	botInstance.onText(/^\/liberar$/, async (msg) => {
		const chatId = msg.chat.id;
		if (!esVendedor(chatId)) return;

		const telefonoCliente = relayActivo.get(String(msg.chat.id));
		if (!telefonoCliente) {
			await botInstance.sendMessage(chatId, '⚠️ No tienes ningún lead activo.');
			return;
		}

		const conversacion = await dbModule.obtenerConversacionPorTelefono(telefonoCliente);
		if (conversacion) {
			await dbModule.actualizarConversacion(
				conversacion.id,
				conversacion.mensajes,
				conversacion.lead_score,
				'activo'
			);
			await supabase.from('conversaciones').update({ vendedor_telegram_id: null }).eq('id', conversacion.id);
		}

		relayActivo.delete(String(msg.chat.id));
		await botInstance.sendMessage(chatId, '✅ Lead liberado. El bot retomará la conversación.');

		await whatsappMod.enviarMensaje(
			telefonoCliente,
			'¡Hola de nuevo! Soy Frío Pro 🤖 Continuemos donde lo dejamos. ¿En qué le puedo ayudar? 😊'
		);
	});

	botInstance.onText(/^\/pausa$/, async (msg) => {
		const chatId = msg.chat.id;
		if (!esVendedor(chatId)) return;

		const telefonoCliente = relayActivo.get(String(chatId));
		if (!telefonoCliente) {
			await botInstance.sendMessage(chatId, '⚠️ No tienes ningún lead activo.');
			return;
		}

		await whatsappMod.enviarMensaje(
			telefonoCliente,
			'Un momento por favor, le atendemos en breve. ⏳'
		);

		await botInstance.sendMessage(
			chatId,
			'⏸️ Conversación en pausa.\nEl cliente fue notificado.\nEscribe cualquier mensaje para retomar.'
		);
	});

	botInstance.onText(/^\/historial$/, async (msg) => {
		const chatId = msg.chat.id;
		if (!esVendedor(chatId)) return;

		const telefonoCliente = relayActivo.get(String(msg.chat.id));
		if (!telefonoCliente) {
			await botInstance.sendMessage(chatId, '⚠️ No tienes ningún lead activo.');
			return;
		}

		const conversacion = await dbModule.obtenerConversacionPorTelefono(telefonoCliente);
		if (!conversacion) {
			await botInstance.sendMessage(chatId, '❌ No se encontró la conversación para ese lead.');
			return;
		}

		const mensajes = conversacion.mensajes || [];
		const ultimos = mensajes.slice(-10);
		const mensajesFormateados = ultimos.map((m) => {
			if (m.role === 'user') return `👤 Cliente: ${m.content}`;
			if (m.role === 'assistant') return `🤖 Bot: ${m.content}`;
			return `💬 ${m.content}`;
		}).join('\n\n');

		await botInstance.sendMessage(chatId, `📋 *Últimos mensajes:*\n\n${mensajesFormateados || 'Sin historial reciente.'}`, {
			parse_mode: 'Markdown'
		});
	});

	botInstance.onText(/^\/(start|ayuda)$/, async (msg) => {
		const chatId = msg.chat.id;

		if (!esVendedor(chatId)) {
			await botInstance.sendMessage(chatId, '⛔ No tienes permiso.');
			return;
		}

		if (esVendedor(chatId) && !esDueno(chatId)) {
			const menuVendedor =
				'👋 *Panel de Vendedor - Neveras Bot*\n\n' +
				'📋 *Comandos disponibles:*\n' +
				'/tomar [telefono] - Tomar un lead asignado\n' +
				'/historial - Ver conversación del cliente\n' +
				'/cerrar - Marcar venta como exitosa\n' +
				'/liberar - Devolver lead al bot\n' +
				'/pausa - Poner cliente en espera\n' +
				'/ayuda - Ver esta lista';

			await botInstance.sendMessage(chatId, menuVendedor, { parse_mode: 'Markdown' });
			return;
		}

		const ayuda =
			'👋 *Panel de Inventario - Neveras Bot*\n\n' +
			'📸 Para *agregar* una nevera:\n' +
			'1. Envía la foto\n' +
			'2. Describe la nevera por *audio* o *texto* (como quieras)\n' +
			'3. La IA organiza todo automáticamente\n\n' +
			'📋 *Comandos:*\n' +
			'/inventario - Ver neveras disponibles\n' +
			'/eliminar [id] - Marcar como vendida\n' +
			'/estadisticas - Resumen de ventas\n' +
			'/ayuda - Ver esta lista';

		await botInstance.sendMessage(chatId, ayuda, { parse_mode: 'Markdown' });
	});

	botInstance.on('polling_error', (err) => {
		console.error('[Telegram]', err.message);
	});

	return botInstance;
}

async function reenviarMensajeAVendedor(telefonoCliente, mensajeCliente, nombreCliente, dbModule) {
	try {
		const conversacion = await dbModule.obtenerConversacionPorTelefono(telefonoCliente);
		if (!conversacion || !conversacion.vendedor_telegram_id) return false;

		const telegramIdVendedor = conversacion.vendedor_telegram_id;
		const vendedorTieneRelay = relayActivo.get(String(telegramIdVendedor)) === telefonoCliente;

		if (!vendedorTieneRelay && telegramIdVendedor) {
			relayActivo.set(String(telegramIdVendedor), telefonoCliente);
			await botInstance.sendMessage(
				telegramIdVendedor,
				`⚡ *Reconexión automática*\n\nEl cliente +${telefonoCliente} acaba de escribir.\nEl relay fue restaurado automáticamente.\n\n💬 Su mensaje:\n"${mensajeCliente}"`,
				{ parse_mode: 'Markdown' }
			);
			return true;
		}

		await botInstance.sendMessage(
			conversacion.vendedor_telegram_id,
			`💬 *${nombreCliente}:*\n${mensajeCliente}`,
			{ parse_mode: 'Markdown' }
		);

		return true;
	} catch (error) {
		console.error('Error al reenviar mensaje a vendedor:', error);
		return false;
	}
}

async function notificarCotizacionEnvio(cotizacionId, ciudad, nombreNevera, telefonoCliente) {
	try {
		if (!botInstance) return;

		const chatId = process.env.TELEGRAM_OWNER_CHAT_ID;
		const mensaje =
			'🚚 *COTIZACIÓN DE ENVÍO REQUERIDA*\n\n' +
			`👤 Cliente: +${telefonoCliente}\n` +
			`📦 Nevera: ${nombreNevera}\n` +
			`📍 Ciudad: ${ciudad}\n` +
			`🔑 ID: ${cotizacionId}\n\n` +
			'✏️ Responde con:\n' +
			`/envio ${cotizacionId} [precio]\n` +
			`Ejemplo: /envio ${cotizacionId} 95000`;

		await botInstance.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
	} catch (error) {
		console.error('Error al notificar cotización de envío:', error);
	}
}

async function notificarLeadCaliente(datosLead) {
	try {
		if (!botInstance) return;

		const idsVendedores = process.env.TELEGRAM_VENDEDORES_IDS
			? process.env.TELEGRAM_VENDEDORES_IDS.split(',').map((id) => id.trim()).filter(Boolean)
			: [];

		const destinatarios = idsVendedores.length > 0
			? idsVendedores
			: [String(process.env.TELEGRAM_OWNER_CHAT_ID)];

		const mensaje =
			'🔥🔥 *LEAD CALIENTE* 🔥🔥\n\n' +
			`👤 *Cliente:* ${datosLead.nombre}\n` +
			`📱 *Teléfono:* +${datosLead.telefono}\n` +
			`🏪 *Negocio:* ${datosLead.tipoNegocio}\n` +
			`❄️ *Interesado en:* ${datosLead.neveraDeInteres}\n` +
			`📊 *Score:* ${datosLead.leadScore}/100\n\n` +
			`💬 *Resumen:* ${datosLead.resumenTexto}\n\n` +
			`👉 *Para atenderle:* /tomar ${datosLead.telefono}\n` +
			`_(Escribe ese comando para iniciar el chat con el cliente)_`;

		for (const chatId of destinatarios) {
			try {
				await botInstance.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
			} catch (errorEnvio) {
				console.error(`Error enviando lead caliente a ${chatId}:`, errorEnvio.message);
			}
		}
	} catch (error) {
		console.error('Error al notificar lead caliente:', error);
	}
}

function obtenerInstanciaBot() {
	return botInstance;
}

module.exports = {
	iniciarBot,
	notificarCotizacionEnvio,
	notificarLeadCaliente,
	reenviarMensajeAVendedor,
	obtenerInstanciaBot,
	subirFotoASupabase,
	eliminarFotoDeSupabase
};
