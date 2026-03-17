require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const PATRONES_ENVIO = [
	'envío a', 'envio a', 'enviar a', 'llevar a', 'despachar a',
	'flete a', 'flete para', 'mandan a', 'manda a', 'hacen envíos',
	'hacen envios', 'llega a', 'lo mandan', 'costo de envío',
	'costo de envio', 'valor del envío', 'valor del envio',
	'cuánto sale el envío', 'cuanto sale el envio',
	'cuánto cuesta el envío', 'cuanto cuesta el envio',
	'queda el envío', 'queda el envio', 'quedaría el envío', 'quedaria el envio',
	'lo mandan a', 'lo despachan a', 'me lo mandan', 'me lo despachan'
];

const CIUDADES_ORDENADAS = [
	'bogotá', 'bogota', 'medellín', 'medellin', 'cali',
	'barranquilla', 'cartagena', 'cúcuta', 'cucuta', 'bucaramanga',
	'pereira', 'santa marta', 'ibagué', 'ibague', 'pasto', 'manizales',
	'neiva', 'villavicencio', 'armenia', 'montería', 'monteria',
	'sincelejo', 'valledupar', 'popayán', 'popayan', 'tunja',
	'riohacha', 'quibdó', 'quibdo', 'florencia', 'yopal', 'arauca',
	'soacha', 'zipaquirá', 'zipaquira', 'facatativá', 'facatativa',
	'chía', 'chia', 'mosquera', 'funza',
	'palmira', 'bello', 'buenaventura', 'barrancabermeja', 'soledad',
	'floridablanca', 'girón', 'giron', 'duitama', 'sogamoso',
	'tuluá', 'tulua', 'cartago', 'buga', 'girardot', 'fusagasugá',
	'fusagasuga', 'la dorada', 'líbano', 'libano',
	'magangué', 'magangue', 'lorica', 'cereté', 'cerete',
	'apartadó', 'apartado', 'turbo', 'caucasia', 'itagüí', 'itagui',
	'envigado', 'sabaneta', 'rionegro', 'marinilla', 'la ceja'
];

const NORMALIZAR_CIUDAD = {
	bogota: 'Bogotá',
	medellin: 'Medellín',
	cucuta: 'Cúcuta',
	ibague: 'Ibagué',
	monteria: 'Montería',
	popayan: 'Popayán',
	quibdo: 'Quibdó',
	zipaquira: 'Zipaquirá',
	facatativa: 'Facatativá',
	chia: 'Chía',
	giron: 'Girón',
	tulua: 'Tuluá',
	fusagasuga: 'Fusagasugá',
	libano: 'Líbano',
	magangue: 'Magangué',
	cerete: 'Cereté',
	apartado: 'Apartadó',
	itagui: 'Itagüí'
};

function capitalizarTexto(texto) {
	return texto
		.split(' ')
		.filter(Boolean)
		.map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1))
		.join(' ');
}

function detectarSolicitudEnvio(mensajeCliente) {
	const mensajeLower = String(mensajeCliente || '').toLowerCase();
	const tienePeticion = PATRONES_ENVIO.some((patron) => mensajeLower.includes(patron));

	if (!tienePeticion) {
		return { esSolicitudEnvio: false, ciudad: null };
	}

	const ciudadEncontrada = CIUDADES_ORDENADAS.find((ciudad) => mensajeLower.includes(ciudad));
	if (!ciudadEncontrada) {
		return { esSolicitudEnvio: true, ciudad: null };
	}

	const claveNormalizada = ciudadEncontrada.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
	const ciudad = NORMALIZAR_CIUDAD[claveNormalizada] || capitalizarTexto(ciudadEncontrada);

	return { esSolicitudEnvio: true, ciudad };
}

async function procesarSolicitudEnvio(conversacion, ciudad, telegramModule, dbModule) {
	try {
		const mensajesTexto = (conversacion.mensajes || [])
			.map((m) => m.content || '')
			.join(' ')
			.toLowerCase();

		const tiposNevera = ['horizontal', 'vertical', 'exhibidora', 'congelador'];
		const tipoMencionado = tiposNevera.find((t) => mensajesTexto.includes(t)) || 'nevera';

		const { data: cotizacionExistente } = await supabase
			.from('cotizaciones_envio')
			.select('id, ciudad_destino, estado')
			.eq('conversacion_id', conversacion.id)
			.eq('estado', 'pendiente')
			.maybeSingle();

		if (cotizacionExistente) {
			if (ciudad && cotizacionExistente.ciudad_destino === 'Ciudad por confirmar') {
				await supabase
					.from('cotizaciones_envio')
					.update({ ciudad_destino: ciudad })
					.eq('id', cotizacionExistente.id);

				await telegramModule.notificarCotizacionEnvio(
					cotizacionExistente.id,
					ciudad,
					tipoMencionado,
					conversacion.telefono,
					dbModule
				);

				return `📦 Perfecto, ya actualicé su ciudad destino a *${ciudad}*. Le confirmo el costo en máximo 1 hora. ⏱️ 😊`;
			}

			if (!ciudad) {
				return '📦 Claro, hacemos envíos a toda Colombia.\n\n¿Me puede indicar a qué ciudad sería el envío?';
			}

			return '📦 Ya estamos consultando el costo de envío para usted. Le confirmo en máximo 1 hora. ⏱️ ¿Tiene alguna otra duda? 😊';
		}

		if (!ciudad) {
			// No crear cotización hasta tener ciudad real
			return '¿A qué ciudad sería el envío?';
		}

		const cotizacion = await dbModule.crearCotizacionEnvio(
			conversacion.id,
			ciudad,
			null
		);

		if (!cotizacion) {
			throw new Error('No se pudo crear la cotización de envío');
		}

		await telegramModule.notificarCotizacionEnvio(
			cotizacion.id,
			ciudad,
			tipoMencionado,
			conversacion.telefono,
			dbModule
		);

		if (ciudad) {
			return `📦 Estoy consultando el costo de envío a *${ciudad}* con nuestro equipo.\n\nLe confirmo en máximo 1 hora. ⏱️\n\nMientras tanto, ¿tiene alguna otra duda sobre la nevera? 😊`;
		}

		return '📦 Claro, hacemos envíos a toda Colombia.\n\n¿Me puede indicar a qué ciudad sería el envío?\nLe consulto el valor con nuestro equipo de inmediato. ⏱️';
	} catch (error) {
		console.error('Error al procesar solicitud de envío:', error);
		return 'Disculpe, tuve un inconveniente. Por favor indíquenos su ciudad de destino. 😊';
	}
}

async function procesarRespuestaDueno(cotizacionId, precioEnvio, whatsappModule, dbModule) {
	try {
		await dbModule.responderCotizacionEnvio(cotizacionId, precioEnvio);

		const cotizacion = await dbModule.obtenerCotizacionPendiente(cotizacionId);
		if (!cotizacion) return false;

		const telefonoCliente = cotizacion.conversaciones?.telefono;
		if (!telefonoCliente) return false;

		const precioFormateado = Number(precioEnvio).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

		const mensajeCliente =
			`✅ *¡Ya tenemos el valor del envío!*\n\n` +
			`📍 Ciudad destino: ${cotizacion.ciudad_destino}\n` +
			`🚚 Costo de envío: *$${precioFormateado} COP*\n\n` +
			`Este valor incluye el transporte hasta su puerta con seguro de carga.\n\n` +
			`¿Desea proceder con la compra? 😊`;

		await whatsappModule.enviarMensaje(telefonoCliente, mensajeCliente);
		return true;
	} catch (error) {
		console.error('Error al procesar respuesta de dueño para envío:', error);
		return false;
	}
}

module.exports = {
	detectarSolicitudEnvio,
	procesarSolicitudEnvio,
	procesarRespuestaDueno
};
