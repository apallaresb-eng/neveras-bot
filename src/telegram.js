const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const Groq = require('groq-sdk');
const fs = require('fs');
const path = require('path');
const whatsappMod = require('./whatsapp');
const VisualAgent = require('./agents/VisualAgent');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

let botInstance = null;
const estadosConversacion = new Map();
// Ya no usamos relayActivo porque el bot responderá usando el message_thread_id
// El ID del Súper Grupo donde se crearán los topics:
const SUPER_GROUP_ID = process.env.TELEGRAM_OWNER_CHAT_ID; // Se asume que el owner configurará su ID o la de su grupo aquí.
// Map en memoria por si Supabase no tiene la columna aún: Map<telefono, thread_id>
const temporaryThreadMap = new Map();

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
		let buffer = Buffer.from(response.data);

		// PASO Opcional: Remover fondo si tenemos API key configurada
		buffer = await VisualAgent.removerFondo(buffer);

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
					content: `Eres un asistente experto que extrae información de neveras industriales recibida desde un audio transcrito en jerga colombiana.
ATENCIÓN: Como proviene de un reconocimiento de voz, puede haber errores fonéticos. Corrige mentalmente palabras como "aseb/hace" -> "Haceb", "imbera" -> "Imbera", "botellero" -> "Enfriador", "millon" -> "1000000", etc.
A partir de la descripción libre, extrae los campos y responde ÚNICAMENTE con un JSON válido con esta estructura exacta:
{
	"nombre": "Marca y modelo corto de la nevera (ej. Exhibidora Haceb)",
	"descripcion": "Descripción comercial atractiva de 1-2 oraciones para seducir al cliente. Corrige los errores de gramática y transcripción del audio.",
	"especificaciones": "Especificaciones técnicas mencionadas (voltaje, gas, estado, temperatura, etc).",
	"precio": número entero sin puntos ni letras (ej. 1500000),
	"tipo": "horizontal" | "vertical" | "exhibidora" | "congelador",
	"uso_recomendado": "Tipo de negocio ideal (ej. Carnicería, Fruver, Droguería)",
	"capacidad_litros": número entero o null
}
Si no se dice explícitamente el precio o algún campo, trata de inferirlo lógicamente del contexto. Si es imposible, pon null.
NO incluyas saludos ni comillas Markdown. Tu salida deber ser 100% parseable con JSON.parse().`
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

	const esDueno = (chatId) => {
		const admins = [
			process.env.TELEGRAM_OWNER_CHAT_ID,
			...(process.env.TELEGRAM_ADMINS_IDS || '').split(',').map(x => x.trim()).filter(Boolean)
		];
		return admins.includes(String(chatId));
	};
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
		const senderId = msg.from.id;

		if (!esDueno(senderId)) {
			await botInstance.sendMessage(chatId, '⛔ No tienes permiso para agregar inventario.', { reply_to_message_id: msg.message_id });
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
		const senderId = msg.from.id;

		if (!esDueno(senderId)) return;

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

		const chatId = Number(msg.chat.id);
		const isSuperGroup = chatId === Number(SUPER_GROUP_ID);
		const threadId = msg.message_thread_id;

		// Si el mensaje viene del SúperGrupo, dentro de un Topic, y no es un comando
		if (isSuperGroup && threadId && !msg.text.startsWith('/')) {
			// Buscar a qué teléfono pertenece este thread
			let telefonoCliente = null;
			
			// 1. Buscar en memoria temporal
			for (const [tel, tId] of temporaryThreadMap.entries()) {
				if (tId === threadId) {
					telefonoCliente = tel;
					break;
				}
			}

			// 2. Si no está en memoria, buscar en la BD (cuando la columna exista)
			if (!telefonoCliente) {
				const convId = await dbModule.obtenerConversacionPorThreadId(threadId);
				if (convId) telefonoCliente = convId.telefono;
			}

			if (telefonoCliente) {
				// Enviar a WhatsApp
				await whatsappMod.enviarMensaje(telefonoCliente, msg.text);
				
				// Actualizar BD
				const conv = await dbModule.obtenerConversacionPorTelefono(telefonoCliente);
				if (conv) {
					// Asignar el vendedor que respondió la primera vez
					if (!conv.vendedor_telegram_id) {
						await dbModule.asignarVendedor(conv.id, msg.from.id);
					}
					
					const nuevoHistorial = [...(conv.mensajes || []), { role: 'assistant', content: msg.text, tipo: 'vendedor' }];
					await dbModule.actualizarConversacion(conv.id, nuevoHistorial, conv.lead_score, 'escalado');
				}
				return;
			}
		}

		if (msg.text.startsWith('/')) return;

		const senderChatId = msg.chat.id;
		const senderId = msg.from.id;
		if (!esDueno(senderId)) return;

		const texto = msg.text.trim();
		if (!estadosConversacion.has(senderChatId)) return;

		const estado = estadosConversacion.get(senderChatId);

		if (estado.paso === 'esperando_descripcion') {
			await botInstance.sendMessage(senderChatId, '⏳ Procesando descripción con IA...');
			await procesarDescripcionLibre(senderChatId, texto);
			return;
		}

		if (estado.paso === 'esperando_confirmacion') {
			const respuesta = texto.toLowerCase();

			if (respuesta.includes('si') || respuesta.includes('sí')) {
				await guardarNeveraEnBD(senderChatId);
				return;
			}

			if (respuesta.includes('no')) {
				await eliminarFotoDeSupabase(estado.datos.nombreArchivo);
				estadosConversacion.delete(senderChatId);
				await botInstance.sendMessage(
					senderChatId,
					'❌ Cancelado. La foto fue eliminada.\nEnvía una nueva foto cuando quieras.'
				);
				return;
			}

			await botInstance.sendMessage(senderChatId, '⚠️ Responde *SÍ* para guardar o *NO* para cancelar.', {
				parse_mode: 'Markdown'
			});
		}
	});

	botInstance.onText(/^\/inventario$/, async (msg) => {
		const chatId = msg.chat.id;
		const senderId = msg.from.id;

		if (!esDueno(senderId)) {
			await botInstance.sendMessage(chatId, '⛔ No tienes permiso para ver el inventario.', { reply_to_message_id: msg.message_id });
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
		const senderId = msg.from.id;

		if (!esDueno(senderId)) {
			await botInstance.sendMessage(chatId, '⛔ No tienes permiso para eliminar neveras.', { reply_to_message_id: msg.message_id });
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
		const senderId = msg.from.id;

		if (!esDueno(senderId)) {
			await botInstance.sendMessage(chatId, '⛔ No tienes permiso para ver estadísticas.', { reply_to_message_id: msg.message_id });
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
		const senderId = msg.from.id;

		if (!esDueno(senderId)) {
			await botInstance.sendMessage(chatId, '⛔ No tienes permiso de configuración de envíos.', { reply_to_message_id: msg.message_id });
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
		// Comando deprecado en el nuevo modelo de hilos
		await botInstance.sendMessage(msg.chat.id, '⚠️ Comando obsoleto. Ahora simplemente responde dentro del Hilo/Topic del cliente para hablar con él.', { reply_to_message_id: msg.message_id });
	});

	botInstance.onText(/^\/cerrar$/, async (msg) => {
		const isSuperGroup = Number(msg.chat.id) === Number(SUPER_GROUP_ID);
		const threadId = msg.message_thread_id;

		if (!isSuperGroup || !threadId) {
			await botInstance.sendMessage(msg.chat.id, '⚠️ Usa este comando dentro del Hilo/Topic del cliente que deseas cerrar.');
			return;
		}

		let telefonoCliente = null;
		for (const [tel, tId] of temporaryThreadMap.entries()) {
			if (tId === threadId) {
				telefonoCliente = tel;
				break;
			}
		}

		if (!telefonoCliente) {
			const convDb = await dbModule.obtenerConversacionPorThreadId(threadId);
			if (convDb) telefonoCliente = convDb.telefono;
		}

		if (!telefonoCliente) {
			await botInstance.sendMessage(msg.chat.id, '⚠️ No se pudo identificar el cliente de este hilo.', { message_thread_id: threadId });
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

			// Agente de Memoria entra en acción asíncronamente
			const Orchestrator = require('./agents/Orchestrator');
			Orchestrator.aprenderDeConversacionCerrada(telefonoCliente, conversacion.mensajes, dbModule);
		}

		await botInstance.sendMessage(msg.chat.id, '✅ Venta marcada como cerrada. ¡Excelente trabajo! 🎉 (Puedes cerrar este Hilo)', { message_thread_id: threadId });

		await whatsappMod.enviarMensaje(
			telefonoCliente,
			'¡Muchas gracias por su compra! 🎉❄️\nFue un placer atenderle.\nCualquier duda adicional, estamos a sus órdenes.'
		);
	});

	botInstance.onText(/^\/liberar$/, async (msg) => {
		const isSuperGroup = Number(msg.chat.id) === Number(SUPER_GROUP_ID);
		const threadId = msg.message_thread_id;

		if (!isSuperGroup || !threadId) {
			await botInstance.sendMessage(msg.chat.id, '⚠️ Usa este comando dentro del Hilo del cliente.');
			return;
		}

		let telefonoCliente = null;
		for (const [tel, tId] of temporaryThreadMap.entries()) {
			if (tId === threadId) {
				telefonoCliente = tel;
				break;
			}
		}

		if (!telefonoCliente) {
			const convDb = await dbModule.obtenerConversacionPorThreadId(threadId);
			if (convDb) telefonoCliente = convDb.telefono;
		}

		if (!telefonoCliente) return;

		const conversacion = await dbModule.obtenerConversacionPorTelefono(telefonoCliente);
		if (conversacion) {
			await dbModule.actualizarConversacion(
				conversacion.id,
				conversacion.mensajes,
				conversacion.lead_score,
				'activo'
			);
			await dbModule.desasignarVendedor(conversacion.id);
		}

		await botInstance.sendMessage(msg.chat.id, '✅ Lead devuelto al bot. El bot retomará la conversación.', { message_thread_id: threadId });

		await whatsappMod.enviarMensaje(
			telefonoCliente,
			'¡Hola de nuevo! Soy Frío Pro 🤖 Continuemos donde lo dejamos. ¿En qué le puedo ayudar? 😊'
		);
	});

	botInstance.onText(/^\/pausa$/, async (msg) => {
		const isSuperGroup = Number(msg.chat.id) === Number(SUPER_GROUP_ID);
		const threadId = msg.message_thread_id;

		if (!isSuperGroup || !threadId) return;

		let telefonoCliente = null;
		for (const [tel, tId] of temporaryThreadMap.entries()) {
			if (tId === threadId) {
				telefonoCliente = tel;
				break;
			}
		}
		
		if (!telefonoCliente) {
			const convDb = await dbModule.obtenerConversacionPorThreadId(threadId);
			if (convDb) telefonoCliente = convDb.telefono;
		}

		if (!telefonoCliente) return;

		await whatsappMod.enviarMensaje(
			telefonoCliente,
			'Un momento por favor, le atendemos en breve. ⏳'
		);

		await botInstance.sendMessage(
			msg.chat.id,
			'⏸️ Conversación en pausa.\nEl cliente fue notificado.\nEscribe cualquier mensaje para retomar.',
			{ message_thread_id: threadId }
		);
	});

	botInstance.onText(/^\/historial$/, async (msg) => {
		const isSuperGroup = Number(msg.chat.id) === Number(SUPER_GROUP_ID);
		const threadId = msg.message_thread_id;

		if (!isSuperGroup || !threadId) return;

		let telefonoCliente = null;
		for (const [tel, tId] of temporaryThreadMap.entries()) {
			if (tId === threadId) {
				telefonoCliente = tel;
				break;
			}
		}

		if (!telefonoCliente) {
			const convDb = await dbModule.obtenerConversacionPorThreadId(threadId);
			if (convDb) telefonoCliente = convDb.telefono;
		}

		if (!telefonoCliente) return;

		const conversacion = await dbModule.obtenerConversacionPorTelefono(telefonoCliente);
		if (!conversacion) return;

		const mensajes = conversacion.mensajes || [];
		const ultimos = mensajes.slice(-10);
		const mensajesFormateados = ultimos.map((m) => {
			if (m.role === 'user') return `👤 Cliente: ${m.content}`;
			if (m.role === 'assistant') return `🤖 Bot: ${m.content}`;
			return `💬 ${m.content}`;
		}).join('\n\n');

		await botInstance.sendMessage(msg.chat.id, `📋 *Últimos mensajes:*\n\n${mensajesFormateados || 'Sin historial reciente.'}`, {
			parse_mode: 'Markdown',
			message_thread_id: threadId
		});
	});

	botInstance.onText(/^\/(start|ayuda)$/, async (msg) => {
		const chatId = msg.chat.id;
		const senderId = msg.from.id;

		if (!esVendedor(senderId)) {
			await botInstance.sendMessage(chatId, '⛔ No tienes permiso. Registra tu ID con el dueño.', { reply_to_message_id: msg.message_id });
			return;
		}

		if (esVendedor(senderId) && !esDueno(senderId)) {
			const menuVendedor =
				'👋 *Panel de Vendedor - Neveras Bot*\n\n' +
				'📋 *Instrucciones Súper Grupo:*\n' +
				'Cuando un lead sea asignado o escalado, el bot creará un Hilo (Topic) nuevo.\n' +
				'Simplemente entra al hilo y responde. Lo que escribas se enviará al cliente.\n\n' +
				'📋 *Comandos dentro del hilo del cliente:*\n' +
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

// Reenviar mensaje al vendedor modificado para crear Hilos (Topics)
async function reenviarMensajeAVendedor(telefonoCliente, mensajeCliente, nombreCliente, dbModule) {
	try {
		const conversacion = await dbModule.obtenerConversacionPorTelefono(telefonoCliente);
		if (!conversacion) return false;

		const superGroupId = process.env.TELEGRAM_OWNER_CHAT_ID;
		let threadId = temporaryThreadMap.get(telefonoCliente) || conversacion.telegram_thread_id;

		// Si no hay Topic creado para este cliente, crearlo
		if (!threadId) {
			const topicName = `📞 Lead: ${nombreCliente || telefonoCliente}`;
			try {
				const topic = await botInstance.createForumTopic(superGroupId, topicName);
				threadId = topic.message_thread_id;
				temporaryThreadMap.set(telefonoCliente, threadId);
				
				// Intentar guardar en BD
				await dbModule.vincularThreadAConversacion(conversacion.id, threadId);

				const intro = `🛎️ *NUEVO LEAD ESCALADO* 🛎️\n\n👤 *Nombre:* ${nombreCliente || 'Desconocido'}\n📱 *Teléfono:* +${telefonoCliente}\n\nEscriban en este hilo para responderle al cliente.`;
				await botInstance.sendMessage(superGroupId, intro, { parse_mode: 'Markdown', message_thread_id: threadId });
			} catch (topicError) {
				console.error('Error creando Forum Topic (Asegúrate de que el bot sea admin del grupo y Topics estén permitidos):', topicError.message);
				return false;
			}
		}

		// Enviar mensaje del cliente al hilo
		await botInstance.sendMessage(
			superGroupId,
			`💬 *Cliente:* ${mensajeCliente}`,
			{ parse_mode: 'Markdown', message_thread_id: threadId }
		);

		return true;
	} catch (error) {
		console.error('Error al reenviar mensaje a vendedor en topic:', error);
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
