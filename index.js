require('dotenv').config();
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

const db = require('./src/database');
const ai = require('./src/ai');
const whatsapp = require('./src/whatsapp');
const telegram = require('./src/telegram');
const escalacion = require('./src/escalacion');
const envios = require('./src/envios');
const followup = require('./src/followup');
const MarketingAgent = require('./src/agents/MarketingAgent');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
	process.env.SUPABASE_URL,
	process.env.SUPABASE_KEY
);

function inferirUsos(temperaturaMin, temperaturaMax, usoRecomendado) {
	if (temperaturaMin == null || temperaturaMax == null) {
		return usoRecomendado || 'Uso recomendado no especificado';
	}

	if (temperaturaMax <= -18) {
		return 'Helados, carnes congeladas, pollos congelados';
	}

	if (temperaturaMax <= 4) {
		return 'Carnes frescas, pescado fresco, mariscos, pollo';
	}

	if (temperaturaMax <= 6) {
		return 'Lácteos, quesos, panadería, repostería';
	}

	if (temperaturaMax <= 8) {
		return 'Bebidas (cerveza, gaseosa, agua), lácteos, flores';
	}

	return usoRecomendado || 'Uso recomendado no especificado';
}

function inferirCapacidadNecesaria(mensaje) {
	const msg = String(mensaje || '').toLowerCase();
	const matchCanastas = msg.match(/(\d+)\s*(canastas?|cajillas?|cajas?)\s*(de\s*)?(cerveza|gaseosa|refresco)?/);
	if (matchCanastas) {
		const cantidad = parseInt(matchCanastas[1], 10);
		return cantidad * 20;
	}

	const matchLitros = msg.match(/(\d+)\s*litros?/);
	if (matchLitros) {
		return parseInt(matchLitros[1], 10);
	}

	const matchKilos = msg.match(/(\d+)\s*(kilos?|kg)/);
	if (matchKilos) {
		return parseInt(matchKilos[1], 10);
	}

	return null;
}

const obtenerContextoInventario = async (capacidadNecesaria = null) => {
	try {
		const { data: neveras, error } = await supabase
			.from('neveras')
			.select('id, nombre, tipo, capacidad_litros, precio, precio_minimo, temperatura_min, temperatura_max, uso_recomendado, descripcion, foto_url')
			.eq('disponible', true);

		console.log('Query inventario resultado:', {
			error: error?.message,
			cantidad: neveras?.length,
			datos: JSON.stringify(neveras)
		});

		if (error || !neveras || neveras.length === 0) {
			return 'INVENTARIO ACTUAL: No hay neveras disponibles en este momento.';
		}

		const lista = neveras.map((n) => {
			const temp = (n.temperatura_min != null && n.temperatura_max != null)
				? `${n.temperatura_min}°C a ${n.temperatura_max}°C`
				: 'No especificada';
			const precio = n.precio
				? `$${Number(n.precio).toLocaleString('es-CO')} COP` : 'consultar';
			const capacidad = n.capacidad_litros
				? `${n.capacidad_litros} litros`
				: 'capacidad no especificada';
			const usoInferido = inferirUsos(n.temperatura_min, n.temperatura_max, n.uso_recomendado);
			const precioMinimo = n.precio_minimo
				? Number(n.precio_minimo).toLocaleString('es-CO')
				: 'consultar';

			return `[ID:${n.id}] ${n.nombre} | Tipo: ${n.tipo || 'N/A'} | ${capacidad} | Temperatura: ${temp} | Apto para: ${usoInferido} | Precio: ${precio} | Precio mínimo negociable (SOLO para Don Carlos, nunca decirlo al cliente): $${precioMinimo} COP`;
		}).join('\n');

		const contextoBase = `INVENTARIO ACTUAL DISPONIBLE (solo esto existe, no inventes más):\n${lista}`;
		if (capacidadNecesaria) {
			return `${contextoBase}\n\nIMPORTANTE: El cliente necesita aproximadamente ${capacidadNecesaria} litros.\nSolo recomendar neveras con capacidad_litros >= ${capacidadNecesaria}.\nSi ninguna tiene suficiente capacidad, decirlo honestamente.`;
		}

		return contextoBase;

	} catch (err) {
		console.error('Error obteniendo inventario para IA:', err);
		return 'INVENTARIO ACTUAL: No se pudo consultar el stock en este momento.';
	}
};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function esperar(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function enviarMensajesDivididos(telefono, texto) {
	const contenido = String(texto || '').trim();
	if (!contenido) return;

	const bloquesBase = contenido
		.split(/\n\n+/)
		.map((bloque) => bloque.trim())
		.filter(Boolean);

	const bloquesFinales = bloquesBase.flatMap((bloque) => {
		if (bloque.length <= 300) return [bloque];

		const partes = bloque
			.split('. ')
			.map((parte, idx, arr) => {
				const textoParte = parte.trim();
				if (!textoParte) return '';
				if (idx < arr.length - 1 && !textoParte.endsWith('.')) {
					return `${textoParte}.`;
				}
				return textoParte;
			})
			.filter(Boolean);

		return partes.length > 0 ? partes : [bloque];
	});

	for (let i = 0; i < bloquesFinales.length; i++) {
		await whatsapp.enviarMensaje(telefono, bloquesFinales[i]);
		if (i < bloquesFinales.length - 1) {
			await esperar(800);
		}
	}
}

function tiempoRelativo(fechaIso) {
	if (!fechaIso) return 'Sin actividad';
	const fecha = new Date(fechaIso);
	const ahora = new Date();
	const diffMs = ahora.getTime() - fecha.getTime();
	
	if (Number.isNaN(diffMs) || diffMs < 0) return 'Hace un momento';

	const minutos = Math.floor(diffMs / 60000);
	if (minutos < 1) return 'Hace unos segundos';
	if (minutos < 60) return `Hace ${minutos} minuto${minutos === 1 ? '' : 's'}`;

	const horas = Math.floor(minutos / 60);
	if (horas < 24) return `Hace ${horas} hora${horas === 1 ? '' : 's'}`;

	const dias = Math.floor(horas / 24);
	return `Hace ${dias} día${dias === 1 ? '' : 's'}`;
}

function enmascararTelefono(telefono) {
	const limpio = String(telefono || '').replace(/\D/g, '');
	const ultimos7 = limpio.slice(-7);
	return ultimos7 ? `***${ultimos7}` : '***';
}

function escaparHtml(valor) {
	return String(valor || '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function colorScore(score) {
	if (score >= 70) return '#10b981';
	if (score >= 40) return '#f59e0b';
	return '#ef4444';
}

function badgeEstado(estado) {
	const valor = String(estado || '').toLowerCase();
	if (valor === 'activo') return { bg: 'rgba(16,185,129,.2)', color: '#10b981', text: 'activo' };
	if (valor === 'escalado') return { bg: 'rgba(245,158,11,.2)', color: '#f59e0b', text: 'escalado' };
	if (valor === 'cerrado') return { bg: 'rgba(148,163,184,.25)', color: '#cbd5e1', text: 'cerrado' };
	if (valor === 'inactivo') return { bg: 'rgba(127,29,29,.45)', color: '#ef4444', text: 'inactivo' };
	return { bg: 'rgba(59,130,246,.2)', color: '#93c5fd', text: valor || 'desconocido' };
}

function generarHTMLDashboard(stats, conversaciones) {
	const metricas = {
		totalVentasMes: stats?.totalVentasMes || 0,
		ventasBot: stats?.ventasBot || 0,
		ventasVendedor: stats?.ventasVendedor || 0,
		conversacionesEscaladas: stats?.conversacionesEscaladas || 0,
		conversacionesActivas: stats?.conversacionesActivas || 0,
		scorePromedio: stats?.scorePromedio || 0
	};

	const filas = (Array.isArray(conversaciones) ? conversaciones : []).map((conv) => {
		const score = Number(conv.lead_score || 0);
		const scoreColor = colorScore(score);
		const estado = badgeEstado(conv.estado);

		return `
			<tr>
				<td>${escaparHtml(enmascararTelefono(conv.telefono))}</td>
				<td>${escaparHtml(conv.nombre_cliente || 'Sin nombre')}</td>
				<td>
					<div class="score-wrap">
						<div class="score-bar"><span style="width:${Math.max(0, Math.min(100, score))}%;background:${scoreColor}"></span></div>
						<small>${score}/100</small>
					</div>
				</td>
				<td><span class="badge" style="background:${estado.bg};color:${estado.color}">${escaparHtml(estado.text)}</span></td>
				<td>${escaparHtml(tiempoRelativo(conv.updated_at))}</td>
			</tr>
		`;
	}).join('');

	const ahora = new Date().toLocaleString('es-CO');

	return `<!doctype html>
<html lang="es">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<meta http-equiv="refresh" content="60">
	<title>Panel Neveras Bot</title>
	<style>
		:root {
			--bg: #0f172a;
			--card: #111827;
			--muted: #94a3b8;
			--text: #e2e8f0;
			--blue: #3b82f6;
			--green: #10b981;
			--yellow: #f59e0b;
			--red: #ef4444;
			--purple: #8b5cf6;
		}
		* { box-sizing: border-box; }
		body {
			margin: 0;
			font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
			background: var(--bg);
			color: var(--text);
			padding: 20px;
		}
		.container { max-width: 1200px; margin: 0 auto; }
		.header { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
		.title { font-size: clamp(1.2rem, 2vw, 1.8rem); margin:0; }
		.subtitle { color: var(--muted); margin-top:6px; }
		.badge-top { background: rgba(16,185,129,.2); color: var(--green); padding: 8px 12px; border-radius: 999px; font-weight: 600; font-size: .9rem; }
		.grid-4 {
			margin-top: 16px;
			display:grid;
			grid-template-columns: repeat(4, minmax(0, 1fr));
			gap: 12px;
		}
		.grid-2 {
			margin-top: 12px;
			display:grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 12px;
		}
		.card {
			background: var(--card);
			border: 1px solid rgba(148,163,184,.18);
			border-radius: 14px;
			padding: 14px;
			min-height: 98px;
		}
		.label { color: var(--muted); font-size: .9rem; }
		.value { font-size: 1.8rem; font-weight: 700; margin-top: 8px; }
		.table-wrap { margin-top: 16px; background: var(--card); border:1px solid rgba(148,163,184,.18); border-radius:14px; overflow:auto; }
		table { width:100%; border-collapse: collapse; min-width: 760px; }
		th, td { padding: 12px; border-bottom: 1px solid rgba(148,163,184,.14); text-align:left; }
		th { color: var(--muted); font-weight: 600; font-size: .92rem; }
		.badge { padding: 4px 10px; border-radius: 999px; font-size: .82rem; font-weight: 700; text-transform: capitalize; }
		.score-wrap small { color: var(--muted); }
		.score-bar { width: 140px; height: 8px; border-radius: 999px; background: rgba(148,163,184,.25); overflow: hidden; margin-bottom: 6px; }
		.score-bar span { display:block; height:100%; border-radius: 999px; }
		.footer-note { margin-top: 12px; color: var(--muted); font-size: .85rem; }
		@media (max-width: 900px) {
			.grid-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
		}
		@media (max-width: 640px) {
			.grid-2 { grid-template-columns: 1fr; }
		}
	</style>
</head>
<body>
	<div class="container">
		<div class="header">
			<div>
				<h1 class="title">❄️ Panel de Control — Neveras Bot</h1>
				<div class="subtitle">Actualizado: ${escaparHtml(ahora)}</div>
			</div>
			<div class="badge-top">⚡ Llama 3.3 70B via Groq</div>
		</div>

		<section class="grid-4">
			<article class="card"><div class="label">🛒 Ventas este mes</div><div class="value" style="color:var(--blue)">${metricas.totalVentasMes}</div></article>
			<article class="card"><div class="label">🤖 Cerradas por bot</div><div class="value" style="color:var(--green)">${metricas.ventasBot}</div></article>
			<article class="card"><div class="label">👤 Por vendedor</div><div class="value" style="color:var(--purple)">${metricas.ventasVendedor}</div></article>
			<article class="card"><div class="label">🔥 Leads escalados</div><div class="value" style="color:var(--yellow)">${metricas.conversacionesEscaladas}</div></article>
		</section>

		<section class="grid-2">
			<article class="card"><div class="label">💬 Conversaciones activas</div><div class="value">${metricas.conversacionesActivas}</div></article>
			<article class="card"><div class="label">📈 Score promedio</div><div class="value">${metricas.scorePromedio}/100</div></article>
		</section>

		<section class="table-wrap">
			<table>
				<thead>
					<tr>
						<th>Teléfono</th>
						<th>Nombre</th>
						<th>Score</th>
						<th>Estado</th>
						<th>Última actividad</th>
					</tr>
				</thead>
				<tbody>
					${filas || '<tr><td colspan="5">No hay conversaciones recientes</td></tr>'}
				</tbody>
			</table>
		</section>

		<div class="footer-note">Actualización automática cada 60 segundos</div>
	</div>
</body>
</html>`;
}

app.get('/webhook', whatsapp.verificarWebhook);

app.post('/webhook', async (req, res) => {
	try {
		console.log('Webhook recibido:', JSON.stringify(req.body));

		// Respuesta vacía — Twilio no envía nada al usuario
		res.setHeader('Content-Type', 'text/xml');
		res.status(200).send('<Response></Response>');

		const datos = whatsapp.extraerDatosMensaje(req.body);
		if (!datos) return;
		const enviarMensaje = whatsapp.enviarMensaje;

		// Si es audio → transcribir primero
		if (datos.esAudio) {
			if (!datos.mediaUrl) {
				await enviarMensaje(
					datos.telefono,
					'No pude escuchar bien el audio 😅 ¿Me lo puedes escribir?'
				);
				return;
			}

			console.log('Audio recibido, transcribiendo...');

			try {
				const fs = require('fs');
				const path = require('path');
				const Groq = require('groq-sdk');
				const groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
				let transcripcionExitosa = false;
				let ultimoErrorAudio = null;

				for (let intento = 1; intento <= 2; intento++) {
					try {
						const credenciales = Buffer.from(
							`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
						).toString('base64');

						const audioRes = await fetch(datos.mediaUrl, {
							headers: {
								'Authorization': `Basic ${credenciales}`
							}
						});

						if (!audioRes.ok) throw new Error(`HTTP ${audioRes.status}`);

						const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
						console.log('Audio descargado, tamaño:', audioBuffer.length, 'bytes');

						const tmpPath = path.join('/tmp', `audio_${Date.now()}.ogg`);
						fs.writeFileSync(tmpPath, audioBuffer);

						const transcripcion = await groqClient.audio.transcriptions.create({
							file: fs.createReadStream(tmpPath),
							model: 'whisper-large-v3',
							language: 'es',
							response_format: 'text'
						});

						try { fs.unlinkSync(tmpPath); } catch (e) {}

						if (transcripcion && transcripcion.length > 0) {
							datos.mensaje = transcripcion;
							transcripcionExitosa = true;
							console.log('Transcripción resultado:', transcripcion);
							break;
						}

						throw new Error('Sin transcripción');
					} catch (err) {
						ultimoErrorAudio = err;
						console.error(`[Audio] Intento ${intento} fallido para ${datos.telefono}:`, err.message);
						if (intento === 1) {
							await esperar(2000);
						}
					}
				}

				if (!transcripcionExitosa) {
					let fallbackExitoso = false;
					for (let intento = 1; intento <= 2; intento++) {
						try {
							const transcripcionFallback = await ai.transcribirAudio(datos.mediaUrl);
							if (transcripcionFallback && transcripcionFallback.length > 0) {
								datos.mensaje = transcripcionFallback;
								fallbackExitoso = true;
								console.log('Transcripción fallback exitosa:', transcripcionFallback);
								break;
							}
							throw new Error('Fallback sin transcripción');
						} catch (fallbackErr) {
							ultimoErrorAudio = fallbackErr;
							console.error(`[Audio] Fallback intento ${intento} fallido para ${datos.telefono}:`, fallbackErr.message);
							if (intento === 1) {
								await esperar(2000);
							}
						}
					}

					if (!fallbackExitoso) {
						console.log(`[Audio] Falló transcripción para ${datos.telefono}:`, ultimoErrorAudio?.message || 'Sin detalle');
						await enviarMensaje(
							datos.telefono,
							'No pude escuchar bien el audio 😅 ¿Me lo puedes escribir?'
						);
						return;
					}
				}
			} catch (err) {
				console.log(`[Audio] Falló transcripción para ${datos.telefono}:`, err.message);
				await enviarMensaje(
					datos.telefono,
					'No pude escuchar bien el audio 😅 ¿Me lo puedes escribir?'
				);
				return;
			}
		}

		if (!datos.mensaje) {
			await whatsapp.enviarMensaje(
				datos.telefono,
				'Hola 👋 ¿En qué le puedo ayudar con nuestras neveras industriales? ❄️'
			);
			return;
		}

		const conversacion = await db.obtenerOCrearConversacion(datos.telefono, datos.nombre);
		if (!conversacion) return;

		if (conversacion.estado === 'escalado') {
			const reenviado = await telegram.reenviarMensajeAVendedor(
				datos.telefono,
				datos.mensaje,
				datos.nombre,
				db
			);

			if (!reenviado) {
				await whatsapp.enviarMensaje(
					datos.telefono,
					'Un momento por favor, nuestro asesor le atenderá en breve. ⏳'
				);
			}
			return;
		}

		if (conversacion.estado === 'cerrado') {
			await db.actualizarConversacion(
				conversacion.id,
				conversacion.mensajes || [],
				0,
				'activo'
			);
			await whatsapp.enviarMensaje(
				datos.telefono,
				'¡Hola de nuevo! 👋 Bienvenido de regreso. ¿En qué le puedo ayudar hoy? Tenemos neveras nuevas disponibles. ❄️'
			);
			return;
		}

		const inventario = await db.obtenerInventarioDisponible();
		const historial = Array.isArray(conversacion.mensajes) ? conversacion.mensajes : [];

		const envioInfo = envios.detectarSolicitudEnvio(datos.mensaje);
		if (envioInfo.esSolicitudEnvio) {
			const respuestaEnvio = await envios.procesarSolicitudEnvio(
				conversacion,
				envioInfo.ciudad,
				telegram,
				db
			);
			const historialConEnvio = [
				...historial,
				{ role: 'user', content: datos.mensaje },
				{ role: 'assistant', content: respuestaEnvio }
			];
			await db.actualizarConversacion(
				conversacion.id,
				historialConEnvio,
				conversacion.lead_score,
				'activo'
			);
			await whatsapp.enviarMensaje(datos.telefono, respuestaEnvio);
			return;
		}

		const capacidadNecesaria = inferirCapacidadNecesaria(datos.mensaje);
		const contextoInventario = await obtenerContextoInventario(capacidadNecesaria);
		console.log('Inventario para IA:', contextoInventario);

		const { respuesta, intencionDetectada, fotoUrl } = await ai.procesarMensaje(
			datos.telefono,
			datos.mensaje,
			historial,
			inventario,
			conversacion.lead_score,
			contextoInventario
		);

		const nuevoScore = ai.calcularLeadScore(historial, intencionDetectada, conversacion.lead_score);

		const nuevoHistorial = [
			...historial,
			{ role: 'user', content: datos.mensaje },
			{ role: 'assistant', content: respuesta }
		];

		if (intencionDetectada === 'listo_para_comprar' && Array.isArray(inventario) && inventario.length > 0) {
			const neveraMencionada = inventario.find((n) =>
				nuevoHistorial.slice(-6).some((m) =>
					m.content?.toLowerCase().includes(n.nombre?.toLowerCase()) ||
					m.content?.toLowerCase().includes(n.tipo?.toLowerCase())
				)
			);

			if (neveraMencionada) {
				const disponibilidad = await db.verificarDisponibilidadNevera(neveraMencionada.id);

				if (disponibilidad.reservada) {
					await whatsapp.enviarMensaje(
						datos.telefono,
						'Le cuento que esa nevera está siendo procesada por otro cliente en este momento. ¡Pero no se preocupe! Tengo otras excelentes opciones para usted. ¿Le muestro las alternativas? 😊'
					);
					await db.actualizarConversacion(conversacion.id, nuevoHistorial, nuevoScore, 'activo');
					return;
				}

				if (!disponibilidad.disponible) {
					await whatsapp.enviarMensaje(
						datos.telefono,
						'Le cuento que esa nevera acaba de ser vendida. ¡Pero tenemos otras opciones disponibles! ¿Le muestro el catálogo actualizado? 😊'
					);
					await db.actualizarConversacion(conversacion.id, nuevoHistorial, nuevoScore, 'activo');
					return;
				}
			}
		}

		await db.actualizarConversacion(conversacion.id, nuevoHistorial, nuevoScore, 'activo');

		const debeEscalar = escalacion.evaluarEscalacion(
			{ ...conversacion, mensajes: nuevoHistorial, lead_score: nuevoScore },
			datos.mensaje
		);

		if (debeEscalar) {
			await escalacion.escalarAVendedor(
				{ ...conversacion, mensajes: nuevoHistorial, lead_score: nuevoScore },
				telegram,
				db
			);
			await whatsapp.enviarMensaje(datos.telefono, escalacion.mensajeDespedidaBot());
			return;
		}

		if (fotoUrl) {
			await whatsapp.enviarMensajeConImagen(datos.telefono, respuesta, fotoUrl);
		} else {
			await enviarMensajesDivididos(datos.telefono, respuesta);
		}
	} catch (error) {
		console.error('[Webhook Error]', error);
	}
});

app.get('/dashboard', async (req, res) => {
	try {
		const stats = await db.obtenerEstadisticas();
		const conversaciones = await db.obtenerUltimasConversaciones(10);
		res.send(generarHTMLDashboard(stats, conversaciones));
	} catch (error) {
		res.status(500).send('Error al cargar dashboard');
	}
});

app.get('/health', (req, res) => {
	res.json({
		status: 'ok',
		timestamp: new Date().toISOString(),
		modelo: 'llama-3.3-70b-versatile',
		version: '1.0.0'
	});
});

// ══════════════════════════════════════════════
// ENDPOINT PÚBLICO: Inventario para landing page
// ══════════════════════════════════════════════
app.get('/inventario-publico', async (req, res) => {
	try {
		res.header('Access-Control-Allow-Origin', '*');
		res.header('Access-Control-Allow-Methods', 'GET');
		res.header('Cache-Control', 'public, max-age=300');

		// Usar la función de database.js en lugar de supabase directo
		const neveras = await db.obtenerNeverasDisponibles();

		res.json({
			ok: true,
			total: neveras.length,
			neveras: neveras,
			actualizado: new Date().toISOString()
		});

	} catch (error) {
		console.error('Error inventario-publico:', error);
		res.status(500).json({ 
			ok: false, 
			neveras: [],
			error: error.message
		});
	}
});

// Preflight CORS para el endpoint anterior
app.options('/inventario-publico', (req, res) => {
	res.header('Access-Control-Allow-Origin', '*');
	res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
	res.sendStatus(200);
});

process.on('uncaughtException', (error) => {
	console.error('[UncaughtException]', error);
});

process.on('unhandledRejection', (reason) => {
	console.error('[UnhandledRejection]', reason);
});

async function iniciarServidor() {
	await telegram.iniciarBot(db);
	followup.iniciarSistemaFollowUp(db, whatsapp, ai);

	// Inicializar el Community Manager (Agente de Mkt) para publicaciones de FB diarias
	MarketingAgent.iniciarActividadDiaria(db);

	setInterval(() => {
		console.log('[Reservas] Verificación de reservas expiradas:', new Date().toISOString());
	}, 600000);

	app.listen(PORT, () => {
		console.log('🚀 Servidor corriendo en puerto ' + PORT);
		console.log('🤖 IA: Llama 3.3 70B via Groq ⚡');
		console.log('📱 WhatsApp: Webhook activo en /webhook');
		console.log('🤙 Telegram: Bot de inventario y relay iniciado');
		console.log('📊 Dashboard: http://localhost:' + PORT + '/dashboard');
	});
}

iniciarServidor().catch(console.error);
