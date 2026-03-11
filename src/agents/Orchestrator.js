const BaseAgent = require('./BaseAgent');
const SalesAgent = require('./SalesAgent');
const ResearcherAgent = require('./ResearcherAgent');
const VerifierAgent = require('./VerifierAgent');
const MemoryAgent = require('./MemoryAgent');

class Orchestrator extends BaseAgent {
  constructor() {
    super('AgenteOrquestador', 'El router cognitivo. Recibe el mensaje, decide a quién invocar, arma el contexto final y lo pasa por el auditor.');
  }

  async procesarMensaje(telefono, mensajeCliente, historial, inventarioDisponible, leadScore, dbInsights = '') {
    try {
      // 1. Detección rápida de Intención y Routing
      const intencion = this.detectarIntencionBasica(mensajeCliente);
      let contextoInvestigador = '';

      // 2. ¿Requiere Inteligencia de Mercado?
      if (intencion === 'precio' || intencion === 'objecion_competencia' || intencion === 'garantia') {
        const analisis = await ResearcherAgent.consultarDudaCliente(mensajeCliente, historial);
        if (analisis) {
          contextoInvestigador = `[CONTEXTO DE MERCADO DEL INVESTIGADOR: ${analisis}]`;
        }
      }

      // 3. Generación de Respuesta por el SalesAgent (El Cerrador)
      // Agregamos los insights históricos + el contexto actual en tiempo real
      const contextoTotal = `[INSIGHTS APRENDIDOS DEL PASADO: ${dbInsights}]\n${contextoInvestigador}`;
      const respuestaPropuesta = await SalesAgent.responderVenta(
        mensajeCliente, 
        historial, 
        inventarioDisponible, 
        contextoTotal, 
        leadScore
      );

      if (!respuestaPropuesta) {
        return { respuesta: 'Tuvimos un error procesando tu solicitud. ¿Me la repites?', intencionDetectada: intencion };
      }

      // 4. Auditoría Verificadora
      const auditoria = await VerifierAgent.auditarRespuesta(respuestaPropuesta, inventarioDisponible);

      if (auditoria.estado === 'RECHAZADO') {
        console.warn('⚠️ [VerifierAgent] Interceptó una respuesta:', auditoria.motivo);
        // Autocorrección: usar la sugerencia como instrucción para que el SalesAgent se rehaga
        if (auditoria.sugerencia_correccion) {
          // Le pasamos la sugerencia como nueva instrucción interna para que el bot RESPONDA mejor,
          // nunca como mensaje directo al cliente.
          const mensajeCorregido = await SalesAgent.responderVenta(
            `CORRECCIÓN INTERNA (NO REVELAR AL CLIENTE). Responde de nuevo, pero esta vez sigue esta guía: "${auditoria.sugerencia_correccion}". El mensaje original del cliente era: "${mensajeCliente}"`,
            historial,
            inventarioDisponible,
            contextoTotal,
            leadScore
          );
          if (mensajeCorregido) {
            return { respuesta: mensajeCorregido, intencionDetectada: intencion, auditado: true };
          }
        }
        return { respuesta: 'Disculpe, verificando el inventario actual me di cuenta de un error en lo que iba a decirle. ¿Me permite revisar y le cuento qué tenemos en bodega?', intencionDetectada: intencion };
      }

      // 5. Todo OK
      return {
        respuesta: respuestaPropuesta,
        intencionDetectada: intencion
      };

    } catch (e) {
      console.error('[Orchestrator Error]', e);
      return {
        respuesta: 'Tuve un inconveniente técnico por un momento. ¿En qué le puedo colaborar? 😊',
        intencionDetectada: 'error'
      };
    }
  }

  detectarIntencionBasica(mensaje) {
    const msj = mensaje.toLowerCase();
    
    if (msj.includes('caro') || msj.includes('competencia') || msj.includes('olx') || msj.includes('mercado libre') || msj.includes('rebaja')) {
      return 'objecion_competencia';
    }
    if (msj.includes('cuánto') || msj.includes('precio') || msj.includes('valor')) {
      return 'precio';
    }
    if (msj.includes('pagar') || msj.includes('transferencia') || msj.includes('compro') || msj.includes('mándela')) {
      return 'cierre';
    }
    if (msj.includes('garantía') || msj.includes('daña') || msj.includes('repuestos')) {
      return 'garantia';
    }
    
    return 'exploracion';
  }

  // Se llama cuando un operador o el sistema cierra un ticket para aprender de él
  async aprenderDeConversacionCerrada(telefono, historial, dbModule) {
    try {
      const data = await MemoryAgent.analizarConversacionCerrada(historial);
      if (data && dbModule) {
        await dbModule.guardarAprendizaje(telefono, data);
        console.log(`✅ [MemoryAgent] Aprendizaje guardado para ${telefono}:`, data.notas);
      }
    } catch(e) {
      console.error('[Orchestrator] Error en aprendizaje continuo:', e);
    }
  }
}

module.exports = new Orchestrator();
