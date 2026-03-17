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
const SUPER_GROUP_ID = process.env.TELEGRAM_SUPER_GROUP_ID; // <--- AQUÍ VA EL -100...
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
			max_tokens: 600,
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
	"precio_minimo": número entero (85% del precio redondeado al millar si no se menciona explícitamente; null si precio es null),
	"tipo": "horizontal" | "vertical" | "exhibidora" | "congelador" | "vitrina",
	"uso_recomendado": "Tipo de negocio ideal (ej. Carnicería, Fruver, Droguería)",
	"capacidad_litros": número entero o null,
	"temperatura_min": número entero en °C o null,
	"temperatura_max": número entero en °C o null
}
REGLAS PARA INFERIR TEMPERATURAS:
- Si menciona exhibidora, bebidas, gaseosas, cerveza, refrescos: temperatura_min=2, temperatura_max=8
- Si menciona carnes frescas, pescado, mariscos, pollo fresco, carnicería: temperatura_min=0, temperatura_max=4
- Si menciona lácteos, quesos, panadería, repostería: temperatura_min=2, temperatura_max=6
- Si menciona helados, congelados, congela, freezer, congelador: temperatura_min=-25, temperatura_max=-18
- Si menciona temperatura explícita (ej: congela a -20): usar ese valor exacto
- Si no puedes inferir: dejar null
REGLA PARA precio_minimo: Si el vendedor no lo menciona, calcula el 85% del precio redondeado al millar más cercano. Si precio es null, precio_minimo también es null.
Si no se dice explícitamente algún campo, trata de inferirlo lógicamente del contexto. Si es imposible, pon null.
NO incluyas saludos ni comillas Markdown. Tu salida debe ser 100% parseable con JSON.parse().`
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

const CAMPOS_CRITICOS = ['nombre', 'precio', 'precio_minimo', 'temperatura_min', 'temperatura_max', 'tipo', 'capacidad_litros', 'uso_recomendado'];

const MENSAJES_CAMPOS = {
	nombre: '¿Cuál es la marca y modelo? Ejemplo: Haceb exhibidora, Imbera G319',
	precio: '¿Cuánto vale esta nevera? (precio de venta en pesos)',
	precio_minimo: '¿Cuál es el mínimo al que la dejaría? (para negociar con el cliente)',
	temperatura_min: '¿A qué temperatura mínima llega? Ejemplo: -20 para congelador, 2 para exhibidora',
	temperatura_max: '¿Cuál es la temperatura máxima? Ejemplo: -18 para congelador, 8 para exhibidora',
	tipo: '¿Qué tipo es? Responde: exhibidora, vertical, horizontal, congelador o vitrina',
	capacidad_litros: '¿Cuántos litros tiene? (capacidad aproximada, ej: 400, 600, 300)',
	uso_recomendado: '¿Para qué tipo de negocio es ideal? (ej: Carnicería, Restaurante, Panadería, Tienda)'
};

function checkCamposFaltantes(datos) {
	const tiposValidos = ['exhibidora', 'vertical', 'horizontal', 'congelador', 'vitrina'];
	return CAMPOS_CRITICOS.filter((campo) => {
		const v = campo === 'uso_recomendado' ? (datos.uso_recomendado ?? datos.usoRecomendado) : datos[campo];
		switch (campo) {
			case 'nombre':
			case 'uso_recomendado':
				return v === null || v === undefined || v === '';
			case 'precio':
			case 'precio_minimo':
				return v === null || v === undefined || v === 0;
			case 'temperatura_min':
			case 'temperatura_max':
			case 'capacidad_litros':
				return v === null || v === undefined;
			case 'tipo':
				return v === null || v === undefined || !tiposValidos.includes(v);
			default:
				return v === null || v === undefined;
		}
	});
}

async function preguntarCampoFaltante(chatId, campo) {
	await botInstance.sendMessage(chatId, `❓ ${MENSAJES_CAMPOS[campo]}`);
}

async function extraerValorCampoDeTexto(campo, respuesta) {
	const instrucciones = {
		nombre: `El vendedor respondió: "${respuesta}". Extrae la marca y modelo de la nevera (ej: "Haceb exhibidora", "Imbera G319"). Responde SOLO con el nombre corto o null.`,
		precio: `El vendedor respondió: "${respuesta}". Extrae ÚNICAMENTE el precio como número entero en pesos colombianos sin puntos ni letras. Si dice tres millones devuelve 3000000. Responde SOLO con el número entero o null.`,
		precio_minimo: `El vendedor respondió: "${respuesta}". Extrae ÚNICAMENTE el precio mínimo como número entero en pesos colombianos. Responde SOLO con el número entero o null.`,
		temperatura_min: `El vendedor respondió: "${respuesta}". Extrae ÚNICAMENTE la temperatura mínima como número entero en grados Celsius (puede ser negativo, ej: -20). Responde SOLO con el número entero o null.`,
		temperatura_max: `El vendedor respondió: "${respuesta}". Extrae ÚNICAMENTE la temperatura máxima como número entero en grados Celsius (puede ser negativo). Responde SOLO con el número entero o null.`,
		tipo: `El vendedor respondió: "${respuesta}". Determina el tipo de nevera. Debe ser exactamente una de: exhibidora, vertical, horizontal, congelador, vitrina. Responde SOLO esa palabra o null.`,
		capacidad_litros: `El vendedor respondió: "${respuesta}". Extrae ÚNICAMENTE la capacidad en litros como número entero (ej: 400, 600, 300). Responde SOLO con el número entero o null.`,
		uso_recomendado: `El vendedor respondió: "${respuesta}". Extrae el tipo de negocio ideal para esta nevera (ej: Carnicería, Restaurante, Panadería, Tienda). Responde SOLO con el texto corto o null.`
	};
	try {
		const completion = await groq.chat.completions.create({
			model: 'llama-3.3-70b-versatile',
			temperature: 0,
			max_tokens: 50,
			messages: [
				{ role: 'system', content: 'Eres un extractor de datos. Responde ÚNICAMENTE con el valor solicitado o la palabra null. Sin explicaciones ni texto adicional.' },
				{ role: 'user', content: instrucciones[campo] }
			]
		});
		const raw = (completion.choices[0]?.message?.content || '').trim();
		if (raw.toLowerCase() === 'null' || raw === '') return null;
		if (['precio', 'precio_minimo', 'temperatura_min', 'temperatura_max', 'capacidad_litros'].includes(campo)) {
			const num = parseInt(raw.replace(/[^-\d]/g, ''), 10);
			return Number.isNaN(num) ? null : num;
		}
		if (campo === 'tipo') {
			const validos = ['exhibidora', 'vertical', 'horizontal', 'congelador', 'vitrina'];
			const lower = raw.toLowerCase().trim();
			return validos.includes(lower) ? lower : null;
		}
		return raw;
	} catch (error) {
		console.error(`Error al extraer valor del campo ${campo}:`, error);
		return null;
	}
}

async function mostrarResumenConfirmacion(chatId) {
	const estado = estadosConversacion.get(chatId);
	if (!estado) return;
	const d = estado.datos;
	const cantFotos = (d.fotosUrls || [d.fotoUrl]).filter(Boolean).length;
	const resumen =
		`*La IA estructuro la informacion asi:*\n\n` +
		`*Nombre:* ${d.nombre || 'No detectado'}\n` +
		`*Descripcion:* ${d.descripcion || 'No detectado'}\n` +
		`*Especificaciones:* ${d.especificaciones || 'No detectado'}\n` +
		`*Precio:* $${d.precio ? formatearPrecio(d.precio) : 'No detectado'} COP\n` +
		`*Precio minimo:* $${d.precio_minimo ? formatearPrecio(d.precio_minimo) : 'No detectado'} COP\n` +
		`*Tipo:* ${d.tipo || 'No detectado'}\n` +
		`*Temperatura:* ${d.temperatura_min ?? 'N/D'}°C min / ${d.temperatura_max ?? 'N/D'}°C max\n` +
		`*Ideal para:* ${d.usoRecomendado || 'No detectado'}\n` +
		`*Capacidad:* ${d.capacidadLitros ? `${d.capacidadLitros}L` : 'No detectado'}\n` +
		`*Fotos:* ${cantFotos} foto(s) guardada(s)\n\n` +
		`Todo correcto?\n*SI* para guardar al inventario\n*NO* para cancelar\n_Envia otro audio/texto si se te olvido algo y lo actualizo._`;
	await botInstance.sendMessage(chatId, resumen, { parse_mode: 'Markdown' });
}

async function procesarRespuestaCampo(chatId, respuesta, estado) {
	const campo = estado.camposFaltantes[estado.campoActual];
	const valor = await extraerValorCampoDeTexto(campo, respuesta);
	if (valor === null) {
		await botInstance.sendMessage(chatId, 'No pude entender ese valor. Intenta de nuevo:');
		await preguntarCampoFaltante(chatId, campo);
		return;
	}
	estado.datos[campo] = valor;
	// Keep camelCase aliases in sync for guardarNeveraEnBD
	if (campo === 'capacidad_litros') estado.datos.capacidadLitros = valor;
	if (campo === 'uso_recomendado') estado.datos.usoRecomendado = valor;
	estado.campoActual++;
	if (estado.campoActual < estado.camposFaltantes.length) {
		const siguienteCampo = estado.camposFaltantes[estado.campoActual];
		estadosConversacion.set(chatId, estado);
		await botInstance.sendMessage(chatId, '✅ Guardado. Siguiente:');
		await preguntarCampoFaltante(chatId, siguienteCampo);
	} else {
		estado.paso = 'esperando_confirmacion';
		delete estado.camposFaltantes;
		delete estado.campoActual;
		estadosConversacion.set(chatId, estado);
		await mostrarResumenConfirmacion(chatId);
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

	async function procesarDescripcionLibre(chatId, textoLibre, textoAnterior = null) {
		const textoFinal = textoAnterior
			? `DESCRIPCION ANTERIOR: "${textoAnterior}"\nCOMPLEMENTO DEL DUENO: "${textoLibre}"\nCombina y corrige la informacion anterior con el complemento. Prioriza los datos mas recientes.`
			: textoLibre;
		const datosIA = await estructurarDescripcionConIA(textoFinal);

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

		const faltantes = checkCamposFaltantes(estado.datos);
		if (faltantes.length > 0) {
			estado.paso = 'completando_campos';
			estado.camposFaltantes = faltantes;
			estado.campoActual = 0;
			estadosConversacion.set(chatId, estado);
			await botInstance.sendMessage(chatId, `⚠️ Faltan ${faltantes.length} dato(s) obligatorio(s). Responde una por una:`);
			await preguntarCampoFaltante(chatId, faltantes[0]);
		} else {
			estado.paso = 'esperando_confirmacion';
			estadosConversacion.set(chatId, estado);
			await mostrarResumenConfirmacion(chatId);
		}
	}

	async function guardarNeveraEnBD(chatId) {
		const estado = estadosConversacion.get(chatId);
		if (!estado) return;

		const fotoUrl = (estado.datos.fotosUrls && estado.datos.fotosUrls.length > 0)
			? estado.datos.fotosUrls[0]
			: estado.datos.fotoUrl;

		const resultado = await dbModule.guardarNevera({
			nombre: estado.datos.nombre,
			descripcion: estado.datos.descripcion,
			especificaciones: estado.datos.especificaciones,
			precio: estado.datos.precio,
			precio_minimo: estado.datos.precio_minimo,
			tipo: estado.datos.tipo,
			capacidad_litros: estado.datos.capacidadLitros,
			uso_recomendado: estado.datos.usoRecomendado,
			temperatura_min: estado.datos.temperatura_min,
			temperatura_max: estado.datos.temperatura_max,
			foto_url: fotoUrl
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
			await botInstance.sendMessage(chatId, 'No tienes permiso para agregar inventario.', { reply_to_message_id: msg.message_id });
			return;
		}

		const estadoActual = estadosConversacion.get(chatId);

		// Si ya hay una nevera en proceso con descripcion pendiente, acumular fotos adicionales
		if (estadoActual && estadoActual.paso === 'esperando_descripcion') {
			await botInstance.sendMessage(chatId, 'Subiendo foto adicional...');
			const fileIdExtra = msg.photo[msg.photo.length - 1].file_id;
			const resExtra = await subirFotoASupabase(botInstance, fileIdExtra);
			if (resExtra) {
				if (!estadoActual.datos.fotosUrls) {
					estadoActual.datos.fotosUrls = [estadoActual.datos.fotoUrl].filter(Boolean);
				}
				estadoActual.datos.fotosUrls.push(resExtra.url);
				estadosConversacion.set(chatId, estadoActual);
				await botInstance.sendMessage(chatId, `Foto ${estadoActual.datos.fotosUrls.length} guardada. Sigue enviando fotos o describe la nevera cuando estes listo.`);
			} else {
				await botInstance.sendMessage(chatId, 'Error al subir la foto adicional. Intenta de nuevo.');
			}
			return;
		}

		if (estadoActual) {
			await botInstance.sendMessage(chatId, 'Ya hay una nevera en proceso. Confirma o cancela primero.');
			return;
		}

		await botInstance.sendMessage(chatId, 'Subiendo foto al servidor...');

		const fileId = msg.photo[msg.photo.length - 1].file_id;
		const resultado = await subirFotoASupabase(botInstance, fileId);

		if (!resultado) {
			await botInstance.sendMessage(chatId, 'Error al subir la foto. Intenta de nuevo.');
			return;
		}

		estadosConversacion.set(chatId, {
			paso: 'esperando_descripcion',
			datos: {
				fotoUrl: resultado.url,
				fotosUrls: [resultado.url],
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
			'*Foto 1 guardada!*\n\nPuedes *enviar mas fotos del mismo equipo* (angulos, serial, interior) y las junto todas al mismo item.\n\nCuando estes listo, *describe la nevera* por audio o texto.\n\n_Ejemplo: "Horizontal Haceb 400 litros, compresor nuevo, congela a -20 grados, vale tres millones ochocientos"_',
			{ parse_mode: 'Markdown' }
		);
	});

	botInstance.on('voice', async (msg) => {
		const chatId = msg.chat.id;
		const senderId = msg.from.id;

		if (!esDueno(senderId)) return;

		const estado = estadosConversacion.get(chatId);
		if (!estado || (
			estado.paso !== 'esperando_descripcion' &&
			estado.paso !== 'esperando_confirmacion' &&
			estado.paso !== 'completando_campos'
		)) return;

		if (estado.paso === 'completando_campos') {
			await botInstance.sendMessage(chatId, '🎤 Transcribiendo respuesta...');
			const transcripcion = await transcribirAudio(botInstance, msg.voice.file_id);
			if (!transcripcion) {
				await botInstance.sendMessage(chatId, 'No pude transcribir. Intenta de nuevo o escribe el valor.');
				return;
			}
			await procesarRespuestaCampo(chatId, transcripcion, estado);
			return;
		}

		const esEdicion = estado.paso === 'esperando_confirmacion';
		await botInstance.sendMessage(chatId, esEdicion ? 'Transcribiendo correccion...' : 'Transcribiendo audio...');

		const transcripcion = await transcribirAudio(botInstance, msg.voice.file_id);

		if (!transcripcion) {
			await botInstance.sendMessage(chatId, 'No pude transcribir el audio. Intenta de nuevo o escribe la descripcion.');
			return;
		}

		await botInstance.sendMessage(
			chatId,
			`*Entendi esto:*\n"${transcripcion}"\n\n${esEdicion ? 'Actualizando informacion...' : 'Procesando...'}`,
			{ parse_mode: 'Markdown' }
		);

		const textoAnterior = esEdicion
			? [
				estado.datos.nombre,
				estado.datos.descripcion,
				estado.datos.especificaciones,
				estado.datos.precio ? `precio: ${estado.datos.precio}` : '',
				estado.datos.tipo ? `tipo: ${estado.datos.tipo}` : ''
			].filter(Boolean).join('. ')
			: null;

		await procesarDescripcionLibre(chatId, transcripcion, textoAnterior);
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

		if (estado.paso === 'completando_campos') {
			await procesarRespuestaCampo(senderChatId, texto, estado);
			return;
		}

		if (estado.paso === 'esperando_confirmacion') {
			// Mensajes de más de 4 palabras son correcciones, nunca cancelaciones
			const palabras = texto.trim().split(/\s+/);
			if (palabras.length > 4) {
				await botInstance.sendMessage(senderChatId, '⏳ Procesando corrección con IA...');
				const textoAnterior = [
					estado.datos.nombre,
					estado.datos.descripcion,
					estado.datos.especificaciones,
					estado.datos.precio ? `precio: ${estado.datos.precio}` : '',
					estado.datos.tipo ? `tipo: ${estado.datos.tipo}` : ''
				].filter(Boolean).join('. ');
				const textoFinal = `DESCRIPCION ANTERIOR: "${textoAnterior}"\nCOMPLEMENTO DEL DUENO: "${texto}"\nCombina y corrige la informacion anterior con el complemento. Prioriza los datos mas recientes.`;
				const datosNuevos = await estructurarDescripcionConIA(textoFinal);
				if (!datosNuevos) {
					await botInstance.sendMessage(senderChatId, '❌ No pude procesar la corrección. Intenta de nuevo.');
					return;
				}
				// Merge: solo sobreescribir si el nuevo valor es válido (no null, no 0, no vacío)
				const esValorValido = (v) => v !== null && v !== undefined && v !== 0 && v !== '';
				for (const [key, val] of Object.entries(datosNuevos)) {
					if (esValorValido(val)) estado.datos[key] = val;
				}
				// Sync camelCase aliases
				if (esValorValido(datosNuevos.uso_recomendado)) estado.datos.usoRecomendado = datosNuevos.uso_recomendado;
				if (esValorValido(datosNuevos.capacidad_litros)) estado.datos.capacidadLitros = datosNuevos.capacidad_litros;
				const faltantes = checkCamposFaltantes(estado.datos);
				if (faltantes.length > 0) {
					estado.paso = 'completando_campos';
					estado.camposFaltantes = faltantes;
					estado.campoActual = 0;
					estadosConversacion.set(senderChatId, estado);
					await botInstance.sendMessage(senderChatId, `⚠️ Aún faltan ${faltantes.length} dato(s). Responde una por una:`);
					await preguntarCampoFaltante(senderChatId, faltantes[0]);
				} else {
					estadosConversacion.set(senderChatId, estado);
					await mostrarResumenConfirmacion(senderChatId);
				}
				return;
			}

			const respuesta = texto.toLowerCase().trim();

			if (respuesta.includes('si') || respuesta.includes('sí')) {
				await guardarNeveraEnBD(senderChatId);
				return;
			}

			// Solo cancela si el mensaje es exactamente "no", "No", "NO"
			if (respuesta === 'no') {
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

		const superGroupId = process.env.TELEGRAM_SUPER_GROUP_ID;
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
			`👉 *Para atenderle:* Ve al SuperGrupo → busca el Hilo del cliente y escribe directamente ahí.\n` +
			`_(Si el cliente vuelve a escribir, el hilo se crea automáticamente)_`;

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
