require('dotenv').config();

const PALABRAS_COMPRA_INMEDIATA = [
	'cómo pago',
	'como pago',
	'pagar',
	'me la llevo',
	'la quiero',
	'transferencia',
	'nequi',
	'daviplata',
	'bancolombia',
	'link de pago',
	'cuánto para separar',
	'la aparto',
	'me la quedo',
	'precio final',
	'consignación',
	'qr',
	'efecty',
	'baloto'
];

function capitalizar(texto) {
	if (!texto || typeof texto !== 'string') return 'No mencionado';
	return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function evaluarEscalacion(conversacion, mensajeActual) {
	if (!conversacion) return false;
	if (conversacion.estado === 'escalado' || conversacion.estado === 'cerrado') return false;

	const mensajeLower = String(mensajeActual || '').toLowerCase();
	const tienePalabraClave = PALABRAS_COMPRA_INMEDIATA.some((palabra) => mensajeLower.includes(palabra));

	if ((conversacion.lead_score || 0) >= 70 || tienePalabraClave) {
		return true;
	}

	return false;
}

async function escalarAVendedor(conversacion, telegramModule, dbModule) {
	try {
		const resumen = generarResumenConversacion(conversacion?.mensajes);

		const inventario = await dbModule.obtenerInventarioDisponible();
		const neveraInteres = inventario?.find((n) =>
			n.tipo?.toLowerCase().includes(resumen.neveraDeInteres.toLowerCase()) ||
			n.nombre?.toLowerCase().includes(resumen.neveraDeInteres.toLowerCase())
		);

		if (neveraInteres && resumen.neveraDeInteres !== 'No mencionado') {
			const reservada = await dbModule.reservarNevera(neveraInteres.id, 30);
			if (reservada === true) {
				resumen.resumenTexto += ` | ⏳ Reservada 30min (ID: ${neveraInteres.id.substring(0, 8)})`;
				resumen.neveraId = neveraInteres.id;
			} else {
				resumen.resumenTexto += ' | ⚠️ Ya reservada por otro cliente';
				resumen.neveraId = null;
			}
		}

		await dbModule.actualizarConversacion(
			conversacion.id,
			conversacion.mensajes,
			conversacion.lead_score,
			'escalado'
		);

		await telegramModule.notificarLeadCaliente({
			telefono: conversacion.telefono,
			nombre: conversacion.nombre_cliente || 'Cliente',
			tipoNegocio: resumen.tipoNegocio,
			neveraDeInteres: resumen.neveraDeInteres,
			leadScore: conversacion.lead_score,
			resumenTexto: resumen.resumenTexto
		});

		return true;
	} catch (error) {
		console.error('Error al escalar lead a vendedor:', error);
		return false;
	}
}

function generarResumenConversacion(mensajes) {
	const resumenVacio = {
		nombreCliente: 'No mencionado',
		tipoNegocio: 'No mencionado',
		neveraDeInteres: 'No mencionado',
		ciudadDestino: 'No mencionado',
		resumenTexto: 'Negocio: No mencionado | Interesado en: No mencionado | Ciudad: No mencionado'
	};

	if (!Array.isArray(mensajes) || mensajes.length === 0) {
		return resumenVacio;
	}

	const mensajesUsuario = mensajes.filter((m) => m && m.role === 'user');
	if (mensajesUsuario.length === 0) {
		return resumenVacio;
	}

	const unirTexto = mensajesUsuario
		.map((m) => String(m.content || ''))
		.join(' ')
		.toLowerCase();

	let nombreCliente = 'No mencionado';
	const patronesNombre = [
		/me llamo\s+([a-záéíóúñ]+)/i,
		/soy\s+([a-záéíóúñ]+)/i,
		/mi nombre es\s+([a-záéíóúñ]+)/i
	];

	for (const patron of patronesNombre) {
		const match = unirTexto.match(patron);
		if (match && match[1]) {
			nombreCliente = capitalizar(match[1]);
			break;
		}
	}

	const negocios = [
		'carnicería',
		'fama',
		'restaurante',
		'panadería',
		'pastelería',
		'tienda',
		'miscelánea',
		'farmacia',
		'droguería',
		'hotel',
		'catering',
		'supermercado',
		'cafetería',
		'heladería'
	];
	const tipoNegocioEncontrado = negocios.find((n) => unirTexto.includes(n));
	const tipoNegocio = tipoNegocioEncontrado ? capitalizar(tipoNegocioEncontrado) : 'No mencionado';

	const tiposNevera = ['horizontal', 'vertical', 'exhibidora', 'congelador'];
	const neveraEncontrada = tiposNevera.find((t) => unirTexto.includes(t));
	const neveraDeInteres = neveraEncontrada ? capitalizar(neveraEncontrada) : 'No mencionado';

	const ciudades = [
		'bogotá',
		'medellín',
		'cali',
		'barranquilla',
		'cartagena',
		'cúcuta',
		'bucaramanga',
		'pereira',
		'santa marta',
		'ibagué',
		'pasto',
		'manizales',
		'neiva',
		'villavicencio',
		'armenia',
		'montería',
		'valledupar',
		'popayán'
	];
	const ciudadEncontrada = ciudades.find((c) => unirTexto.includes(c));
	const ciudadDestino = ciudadEncontrada ? capitalizar(ciudadEncontrada) : 'No mencionado';

	const resumenTexto = `Negocio: ${tipoNegocio} | Interesado en: ${neveraDeInteres} | Ciudad: ${ciudadDestino}`;

	return {
		nombreCliente,
		tipoNegocio,
		neveraDeInteres,
		ciudadDestino,
		resumenTexto
	};
}

function mensajeDespedidaBot() {
	return '¡Perfecto! 🎉 Le estoy conectando con uno de nuestros asesores especializados.\n\nLe escribirá en los próximos minutos para enviarle el link de pago y finalizar su compra.\n\n¡Fue un placer atenderle! ❄️🧊';
}

async function liberarReservaAlCerrar(neveraId, dbModule) {
	try {
		if (!neveraId) return false;
		return await dbModule.liberarReservaNevera(neveraId);
	} catch (error) {
		console.error('Error al liberar reserva al cerrar:', error);
		return false;
	}
}

module.exports = {
	evaluarEscalacion,
	escalarAVendedor,
	generarResumenConversacion,
	mensajeDespedidaBot,
	liberarReservaAlCerrar
};
