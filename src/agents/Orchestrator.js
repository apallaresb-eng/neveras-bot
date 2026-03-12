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
      if (intencion === 'precio' || intencion === 'objecion_competencia' || intencion === 'garantia' || intencion === 'menciona_competidor') {
        const analisis = await ResearcherAgent.consultarDudaCliente(mensajeCliente, historial);
        if (analisis) {
          contextoInvestigador = `[CONTEXTO DE MERCADO DEL INVESTIGADOR: ${analisis}]`;
        }
      }

      // Extraer contexto del cliente para inyectar en el prompt de ventas (Mejora 3)
      const datosCliente = await this.extraerContextoRapido(historial, mensajeCliente);
      const strDatosCliente = `[CONTEXTO CLIENTE: Nombre: ${datosCliente.nombre_cliente || 'Desconocido'}, Negocio: ${datosCliente.tipo_negocio || 'Desconocido'}, Equipo buscado: ${datosCliente.equipo_interes || 'Desconocido'}, Ciudad: ${datosCliente.ciudad || 'Desconocido'}]`;

      // 3. Generación de Respuesta por el SalesAgent (El Cerrador)
      // Agregamos los insights históricos + el contexto actual en tiempo real
      const contextoTotal = `[INSIGHTS APRENDIDOS DEL PASADO: ${dbInsights}]\n${contextoInvestigador}\n${strDatosCliente}`;
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
            mensajeCliente,
            historial,
            inventarioDisponible,
            contextoTotal,
            leadScore,
            auditoria.sugerencia_correccion
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
    
    // Intenciones de alta prioridad (transaccionales)
    if (msj.includes('pagar') || msj.includes('transferencia') || msj.includes('compro') || msj.includes('mándela')) {
      return 'cierre';
    }
    if (msj.includes('cuánto') || msj.includes('precio') || msj.includes('valor')) {
      return 'precio';
    }
    // Intenciones agregadas en la mejora (y objeciones)
    if (msj.includes('caro') || msj.includes('competencia') || msj.includes('olx') || msj.includes('mercado libre') || msj.includes('rebaja')) {
      return 'menciona_competidor';
    }
    if (msj.includes('garantía') || msj.includes('daña') || msj.includes('repuestos')) {
      return 'garantia';
    }
    if (msj.includes('envío') || msj.includes('envio') || msj.includes('flete') || msj.includes('despacho')) {
      return 'pide_envio';
    }
    if (msj.includes('foto') || msj.includes('imagen') || msj.includes('verla')) {
      return 'solicita_foto';
    }
    if (msj.includes('medida') || msj.includes('ancho') || msj.includes('alto') || msj.includes('consume') || msj.includes('motor')) {
      return 'pregunta_tecnica';
    }
    if (msj.includes('panadería') || msj.includes('panaderia') || msj.includes('carnicería') || msj.includes('tienda') || msj.includes('restaurante') || msj.includes('negocio')) {
      return 'menciona_negocio_especifico';
    }
    if (msj.includes('hola') || msj.includes('buenas') || msj.includes('buenos dias') || msj.includes('buenos días') || msj.includes('buenas tardes')) {
      return 'saludo_inicial';
    }
    
    return 'exploracion';
  }

  async extraerContextoRapido(historial, mensajeCliente) {
    try {
      const msj = [
        { role: 'system', content: `Eres un extractor de contexto de ventas JSON. Analiza la conversación y extrae estos campos si estuvieron explícitamente mencionados, de lo contrario devuelve "Desconocido". Responde ÚNICAMENTE con JSON válido sin formato markdown de bloques de código: { "nombre_cliente": "", "tipo_negocio": "", "equipo_interes": "", "ciudad": "" }` },
        ...this.formatearHistorial(historial, 6),
        { role: 'user', content: mensajeCliente }
      ];
      let jsonText = await this.razonar(msj, 0.1, 200);
      jsonText = jsonText.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(jsonText || '{}');
    } catch(e) {
      console.error('[Orchestrator] Error extrayendo contexto:', e);
      return {};
    }
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
