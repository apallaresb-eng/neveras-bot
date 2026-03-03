require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function revisarConversaciones(dbModule, whatsappModule, aiModule) {
	try {
		console.log('[FollowUp] Revisando conversaciones:', new Date().toISOString());

		const conversaciones = await dbModule.obtenerUltimasConversaciones(50);
		if (!conversaciones || conversaciones.length === 0) return;

		const activas = conversaciones.filter((c) => c.estado === 'activo' && (c.lead_score || 0) > 20);

		let enviados = 0;
		let inactivados = 0;

		for (const conv of activas) {
			const ultimaActividad = new Date(conv.updated_at);
			const ahora = new Date();
			const horasTranscurridas = (ahora.getTime() - ultimaActividad.getTime()) / 3600000;

			if (horasTranscurridas >= 72) {
				await marcarConversacionInactiva(conv.id, dbModule);
				inactivados += 1;
				continue;
			}

			if (
				horasTranscurridas >= 48 &&
				(conv.followups_enviados || 0) >= 1 &&
				(conv.followups_enviados || 0) < 2
			) {
				await enviarFollowUp(conv, '48h', dbModule, whatsappModule, aiModule);
				enviados += 1;
				continue;
			}

			if (horasTranscurridas >= 24 && (conv.followups_enviados || 0) < 1) {
				await enviarFollowUp(conv, '24h', dbModule, whatsappModule, aiModule);
				enviados += 1;
			}
		}

		console.log(`[FollowUp] Resumen: ${enviados} enviados, ${inactivados} inactivados`);
	} catch (error) {
		console.error('[FollowUp] Error en revisión:', error);
	}
}

async function enviarFollowUp(conversacion, tipo, dbModule, whatsappModule, aiModule) {
	try {
		const { data: convCompleta } = await supabase
			.from('conversaciones')
			.select('mensajes')
			.eq('id', conversacion.id)
			.maybeSingle();
		const historial = Array.isArray(convCompleta?.mensajes) ? convCompleta.mensajes : [];

		let mensajeFollowUp = await aiModule.generarMensajeFollowUp(
			historial,
			tipo === '24h' ? 24 : 48
		);

		if (tipo === '48h') {
			const inventario = await dbModule.obtenerInventarioDisponible();
			if (inventario && inventario.length > 0) {
				const masBaratas = inventario.slice(0, 2);
				let textoNeveras = '\n\n🔥 *Opciones disponibles hoy:*\n';
				masBaratas.forEach((n, i) => {
					const precio = Number(n.precio).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
					textoNeveras += `${i + 1}. ${n.nombre} — $${precio} COP\n`;
				});
				textoNeveras += '\n¿Le interesa alguna? 😊';
				mensajeFollowUp += textoNeveras;
			}
		}

		await whatsappModule.enviarMensaje(conversacion.telefono, mensajeFollowUp);

		await supabase
			.from('conversaciones')
			.update({
				followups_enviados: (conversacion.followups_enviados || 0) + 1
			})
			.eq('id', conversacion.id);

		console.log(`[FollowUp] Enviado tipo ${tipo} a ${conversacion.telefono}`);
	} catch (error) {
		console.error(`[FollowUp] Error enviando follow-up a ${conversacion.telefono}:`, error);
	}
}

async function marcarConversacionInactiva(conversacionId, dbModule) {
	try {
		await dbModule.actualizarConversacion(
			conversacionId,
			undefined,
			undefined,
			'inactivo'
		);
		console.log(`[FollowUp] Conversación ${conversacionId} marcada como inactiva`);
	} catch (error) {
		console.error('[FollowUp] Error al inactivar conversación:', error);
	}
}

function iniciarSistemaFollowUp(dbModule, whatsappModule, aiModule) {
	console.log('[FollowUp] Sistema de seguimiento iniciado ✅');
	console.log('[FollowUp] Revisando conversaciones cada 1 hora');

	revisarConversaciones(dbModule, whatsappModule, aiModule);

	setInterval(() => {
		revisarConversaciones(dbModule, whatsappModule, aiModule);
	}, 3600000);
}

module.exports = { iniciarSistemaFollowUp };
