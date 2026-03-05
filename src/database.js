// Módulo de base de datos Supabase para sistema de ventas de neveras industriales en Colombia
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Inicializar cliente Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// 1. Obtener inventario disponible
async function obtenerInventarioDisponible() {
  try {
    const { data, error } = await supabase
      .from('neveras')
      .select('*')
      .eq('disponible', true)
      .or(`reservada_hasta.is.null,reservada_hasta.lt.${new Date().toISOString()}`)
      .order('precio', { ascending: true });
    
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error al obtener inventario disponible:', error);
    return null;
  }
}

// 13. Reservar nevera por tiempo limitado
async function reservarNevera(neveraId, minutosReserva = 30) {
  try {
    const expiracion = new Date(Date.now() + minutosReserva * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('neveras')
      .update({ reservada_hasta: expiracion })
      .eq('id', neveraId)
      .eq('disponible', true)
      .or(`reservada_hasta.is.null,reservada_hasta.lt.${new Date().toISOString()}`)
      .select('id');

    if (error) throw error;
    if (!data || data.length === 0) return false;

    return true;
  } catch (error) {
    console.error('Error al reservar nevera:', error);
    return false;
  }
}

// 14. Liberar reserva de nevera
async function liberarReservaNevera(neveraId) {
  try {
    const { error } = await supabase
      .from('neveras')
      .update({ reservada_hasta: null })
      .eq('id', neveraId);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Error al liberar reserva de nevera:', error);
    return false;
  }
}

// 15. Verificar disponibilidad y reserva de una nevera
async function verificarDisponibilidadNevera(neveraId) {
  try {
    const { data, error } = await supabase
      .from('neveras')
      .select('disponible, reservada_hasta')
      .eq('id', neveraId)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return { disponible: false, reservada: false, minutosRestantes: 0 };
    }

    const disponible = data.disponible === true;
    const ahora = new Date();
    const fechaReserva = data.reservada_hasta ? new Date(data.reservada_hasta) : null;
    const reservada = fechaReserva !== null && fechaReserva > ahora;
    const minutosRestantes = reservada
      ? Math.ceil((fechaReserva.getTime() - ahora.getTime()) / 60000)
      : 0;

    return { disponible, reservada, minutosRestantes };
  } catch (error) {
    console.error('Error al verificar disponibilidad de nevera:', error);
    return { disponible: false, reservada: false, minutosRestantes: 0 };
  }
}

// 2. Buscar neveras por tipo y/o uso recomendado
async function buscarNeverasPorTipo(tipo, usoRecomendado) {
  try {
    let query = supabase
      .from('neveras')
      .select('id, nombre, descripcion, especificaciones, precio, tipo, capacidad_litros, foto_url');
    
    if (tipo) {
      query = query.ilike('tipo', `%${tipo}%`);
    }
    
    if (usoRecomendado) {
      query = query.ilike('uso_recomendado', `%${usoRecomendado}%`);
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error al buscar neveras por tipo:', error);
    return null;
  }
}

// 3. Obtener o crear conversación
async function obtenerOCrearConversacion(telefono, nombreCliente) {
  try {
    // Buscar conversación activa existente
    const { data: conversacionExistente, error: errorBusqueda } = await supabase
      .from('conversaciones')
      .select('*')
      .eq('telefono', telefono)
      .in('estado', ['activo', 'escalado'])
      .maybeSingle();

    if (errorBusqueda) throw errorBusqueda;
    
    if (conversacionExistente) {
      return conversacionExistente;
    }
    
    // Si no existe, crear una nueva
    const { data: nuevaConversacion, error: errorCreacion } = await supabase
      .from('conversaciones')
      .insert({
        telefono: telefono,
        nombre_cliente: nombreCliente,
        estado: 'activo',
        lead_score: 0,
        mensajes: []
      })
      .select()
      .single();
    
    if (errorCreacion) throw errorCreacion;
    return nuevaConversacion;
  } catch (error) {
    console.error('Error al obtener o crear conversación:', error);
    return null;
  }
}

// 12. Obtener últimas conversaciones
async function obtenerUltimasConversaciones(limite = 10) {
  try {
    const { data, error } = await supabase
      .from('conversaciones')
      .select('id, telefono, nombre_cliente, lead_score, estado, updated_at, followups_enviados')
      .order('updated_at', { ascending: false })
      .limit(limite);

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error al obtener últimas conversaciones:', error);
    return [];
  }
}

// 4. Actualizar conversación
async function actualizarConversacion(id, mensajes, leadScore, estado) {
  try {
    const actualizacion = {
      updated_at: new Date().toISOString()
    };
    
    if (mensajes !== undefined) actualizacion.mensajes = mensajes;
    if (leadScore !== undefined) actualizacion.lead_score = leadScore;
    if (estado !== undefined) actualizacion.estado = estado;
    
    const { data, error } = await supabase
      .from('conversaciones')
      .update(actualizacion)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error al actualizar conversación:', error);
    return null;
  }
}

// 5. Guardar nevera
async function guardarNevera(datos) {
  try {
    const { data, error } = await supabase
      .from('neveras')
      .insert({
        nombre: datos.nombre,
        descripcion: datos.descripcion,
        especificaciones: datos.especificaciones,
        precio: datos.precio,
        tipo: datos.tipo,
        capacidad_litros: datos.capacidad_litros,
        uso_recomendado: datos.uso_recomendado,
        foto_url: datos.foto_url
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error al guardar nevera:', error);
    return null;
  }
}

// 6. Crear cotización de envío
async function crearCotizacionEnvio(conversacionId, ciudadDestino, neveraId) {
  try {
    const { data, error } = await supabase
      .from('cotizaciones_envio')
      .insert({
        conversacion_id: conversacionId,
        ciudad_destino: ciudadDestino,
        nevera_id: neveraId,
        estado: 'pendiente'
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error al crear cotización de envío:', error);
    return null;
  }
}

// 7. Responder cotización de envío
async function responderCotizacionEnvio(cotizacionId, precioEnvio) {
  try {
    const { data, error } = await supabase
      .from('cotizaciones_envio')
      .update({
        estado: 'respondida',
        precio_envio: precioEnvio
      })
      .eq('id', cotizacionId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error al responder cotización de envío:', error);
    return null;
  }
}

// 8. Obtener cotización pendiente
async function obtenerCotizacionPendiente(cotizacionId) {
  try {
    const { data, error } = await supabase
      .from('cotizaciones_envio')
      .select(`
        *,
        conversaciones (
          telefono
        )
      `)
      .eq('id', cotizacionId)
      .single();
    
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error al obtener cotización pendiente:', error);
    return null;
  }
}

// 9. Registrar venta
async function registrarVenta(conversacionId, neveraId, precioFinal, cerradoPor) {
  try {
    // Insertar venta
    const { data: venta, error: errorVenta } = await supabase
      .from('ventas')
      .insert({
        conversacion_id: conversacionId,
        nevera_id: neveraId,
        precio_final: precioFinal,
        cerrado_por: cerradoPor
      })
      .select()
      .single();
    
    if (errorVenta) throw errorVenta;
    
    // Actualizar estado de conversación a 'cerrado'
    const { error: errorActualizacion } = await supabase
      .from('conversaciones')
      .update({ estado: 'cerrado' })
      .eq('id', conversacionId);
    
    if (errorActualizacion) throw errorActualizacion;
    
    return venta;
  } catch (error) {
    console.error('Error al registrar venta:', error);
    return null;
  }
}

// 10. Obtener estadísticas
async function obtenerEstadisticas() {
  try {
    const añoActual = new Date().getFullYear();
    const mesActual = new Date().getMonth() + 1;
    const inicioMes = `${añoActual}-${mesActual.toString().padStart(2, '0')}-01`;
    
    // Total de ventas del mes
    const { count: totalVentasMes, error: error1 } = await supabase
      .from('ventas')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', inicioMes);
    
    if (error1) throw error1;
    
    // Ventas cerradas por bot
    const { count: ventasBot, error: error2 } = await supabase
      .from('ventas')
      .select('*', { count: 'exact', head: true })
      .eq('cerrado_por', 'bot')
      .gte('created_at', inicioMes);
    
    if (error2) throw error2;
    
    // Ventas cerradas por vendedor
    const { count: ventasVendedor, error: error3 } = await supabase
      .from('ventas')
      .select('*', { count: 'exact', head: true })
      .eq('cerrado_por', 'vendedor')
      .gte('created_at', inicioMes);
    
    if (error3) throw error3;
    
    // Conversaciones activas
    const { count: conversacionesActivas, error: error4 } = await supabase
      .from('conversaciones')
      .select('*', { count: 'exact', head: true })
      .eq('estado', 'activo');
    
    if (error4) throw error4;
    
    // Conversaciones escaladas
    const { count: conversacionesEscaladas, error: error5 } = await supabase
      .from('conversaciones')
      .select('*', { count: 'exact', head: true })
      .eq('estado', 'escalado');
    
    if (error5) throw error5;
    
    // Score promedio de conversaciones activas
    const { data: conversacionesConScore, error: error6 } = await supabase
      .from('conversaciones')
      .select('lead_score')
      .eq('estado', 'activo');
    
    if (error6) throw error6;
    
    let scorePromedio = 0;
    if (conversacionesConScore && conversacionesConScore.length > 0) {
      const sumaScores = conversacionesConScore.reduce((sum, conv) => sum + (conv.lead_score || 0), 0);
      scorePromedio = sumaScores / conversacionesConScore.length;
    }
    
    return {
      totalVentasMes: totalVentasMes || 0,
      ventasBot: ventasBot || 0,
      ventasVendedor: ventasVendedor || 0,
      conversacionesActivas: conversacionesActivas || 0,
      conversacionesEscaladas: conversacionesEscaladas || 0,
      scorePromedio: Math.round(scorePromedio * 100) / 100
    };
  } catch (error) {
    console.error('Error al obtener estadísticas:', error);
    return null;
  }
}

// 11. Marcar nevera como no disponible
async function marcarNeveraNoDisponible(neveraId) {
  try {
    const { data, error } = await supabase
      .from('neveras')
      .update({ disponible: false, reservada_hasta: null })
      .eq('id', neveraId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error al marcar nevera como no disponible:', error);
    return null;
  }
}

// 16. Asignar vendedor a conversación escalada
async function asignarVendedor(conversacionId, telegramId) {
  try {
    const { data, error } = await supabase
      .from('conversaciones')
      .update({ vendedor_telegram_id: String(telegramId), estado: 'escalado' })
      .eq('id', conversacionId)
      .is('vendedor_telegram_id', null)
      .select('id');

    if (error) throw error;
    if (!data || data.length === 0) return false;

    return true;
  } catch (error) {
    console.error('Error al asignar vendedor:', error);
    return false;
  }
}

// 17. Obtener conversación escalada por teléfono
async function obtenerConversacionPorTelefono(telefono) {
  try {
    const { data, error } = await supabase
      .from('conversaciones')
      .select('*')
      .eq('telefono', telefono)
      .eq('estado', 'escalado')
      .maybeSingle();

    if (error) throw error;
    return data || null;
  } catch (error) {
    console.error('Error al obtener conversación por teléfono:', error);
    return null;
  }
}

// 18. Obtener conversaciones por vendedor
async function obtenerConversacionesPorVendedor(telegramId) {
  try {
    const { data, error } = await supabase
      .from('conversaciones')
      .select('*')
      .eq('vendedor_telegram_id', String(telegramId))
      .eq('estado', 'escalado');

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error al obtener conversaciones por vendedor:', error);
    return [];
  }
}

// Obtener neveras disponibles para landing page
const obtenerNeverasDisponibles = async () => {
  try {
    const { data, error } = await supabase
      .from('neveras')
      .select('*')
      .eq('disponible', true)
      .order('precio', { ascending: true });
    
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error obtenerNeverasDisponibles:', error);
    return [];
  }
};

// ═══ SISTEMA DE APRENDIZAJE ═══

// Guardar resultado de conversación
const guardarAprendizaje = async (telefono, contexto) => {
  try {
    await supabase.from('bot_aprendizaje').upsert({
      telefono,
      ultimo_contexto: contexto.negocio || null,
      tipo_nevera_buscada: contexto.tipoNevera || null,
      cerro_venta: contexto.cerrVenta || false,
      fue_util: contexto.fueUtil || null,
      notas: contexto.notas || null,
      actualizado_en: new Date().toISOString()
    }, { onConflict: 'telefono' });
  } catch(e) {
    console.error('Error guardando aprendizaje:', e);
  }
};

// Obtener estadísticas de qué respuestas funcionan
const obtenerInsights = async () => {
  try {
    const { data } = await supabase
      .from('bot_aprendizaje')
      .select('tipo_nevera_buscada, cerro_venta, fue_util')
      .not('tipo_nevera_buscada', 'is', null);

    if (!data || data.length === 0) return null;

    const stats = data.reduce((acc, row) => {
      const tipo = row.tipo_nevera_buscada;
      if (!acc[tipo]) acc[tipo] = { total: 0, ventas: 0 };
      acc[tipo].total++;
      if (row.cerro_venta) acc[tipo].ventas++;
      return acc;
    }, {});

    return stats;
  } catch(e) {
    return null;
  }
};

// Exportar todas las funciones
module.exports = {
  obtenerInventarioDisponible,
  buscarNeverasPorTipo,
  obtenerOCrearConversacion,
  actualizarConversacion,
  guardarNevera,
  crearCotizacionEnvio,
  responderCotizacionEnvio,
  obtenerCotizacionPendiente,
  registrarVenta,
  obtenerEstadisticas,
  marcarNeveraNoDisponible,
  obtenerUltimasConversaciones,
  reservarNevera,
  liberarReservaNevera,
  verificarDisponibilidadNevera,
  asignarVendedor,
  obtenerConversacionPorTelefono,
  obtenerConversacionesPorVendedor,
  obtenerNeverasDisponibles,
  guardarAprendizaje,
  obtenerInsights
};
