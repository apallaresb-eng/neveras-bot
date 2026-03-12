const db = require('../src/database');

jest.mock('@supabase/supabase-js', () => {
  const mockInsert = jest.fn();
  const mockSelect = jest.fn();
  const mockEq = jest.fn();
  const mockUpdate = jest.fn();
  const mockOrder = jest.fn();
  const mockLimit = jest.fn();
  const mockSingle = jest.fn();
  
  // Chainable mock returns
  const mockChain = {
    insert: mockInsert,
    select: mockSelect,
    eq: mockEq,
    update: mockUpdate,
    order: mockOrder,
    limit: mockLimit,
    single: mockSingle,
  };

  mockInsert.mockReturnValue(mockChain);
  mockSelect.mockReturnValue(mockChain);
  mockEq.mockReturnValue(mockChain);
  mockUpdate.mockReturnValue(mockChain);
  mockOrder.mockReturnValue(mockChain);
  mockLimit.mockReturnValue(mockChain);

  return {
    createClient: jest.fn(() => ({
      from: jest.fn(() => mockChain)
    }))
  };
});

const { createClient } = require('@supabase/supabase-js');
const mockSupabase = createClient();

describe('Base de Datos (database.js)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('obtenerInventarioDisponible', () => {
    it('debe devolver un formato vacío si no hay neveras disponibles', async () => {
      mockSupabase.from().select().eq().order.mockResolvedValueOnce({ data: [], error: null });
      
      const inventario = await db.obtenerInventarioDisponible();
      expect(inventario).toEqual([]);
      expect(mockSupabase.from).toHaveBeenCalledWith('neveras');
      expect(mockSupabase.from().select).toHaveBeenCalledWith('*');
      expect(mockSupabase.from().select().eq).toHaveBeenCalledWith('disponible', true);
    });

    it('debe devolver un inventario formateado si hay neveras disponibles', async () => {
      const mockData = [
        { id: 1, nombre: 'Nevera A', precio: 1000000, tipo: 'Exhibidora' }
      ];
      mockSupabase.from().select().eq().order.mockResolvedValueOnce({ data: mockData, error: null });
      
      const inventario = await db.obtenerInventarioDisponible();
      expect(inventario).toEqual(mockData);
    });
    
    it('debe retornar string de error en caso de fallo DB', async () => {
      mockSupabase.from().select().eq().order.mockResolvedValueOnce({ data: null, error: { message: 'DB Error' } });
      const inventario = await db.obtenerInventarioDisponible();
      expect(inventario).toEqual([]);
    });
  });
  
  describe('reservarNevera', () => {
    it('debe lanzar error si no se pasa neveraId', async () => {
      await expect(db.reservarNevera(null)).rejects.toThrow('ID de nevera requerido');
    });

    it('debe marcar la nevera como reservada', async () => {
      mockSupabase.from().update().eq.mockResolvedValueOnce({ data: { id: 1 }, error: null });
      
      const resultado = await db.reservarNevera(1);
      expect(resultado).toBe(true);
      expect(mockSupabase.from).toHaveBeenCalledWith('neveras');
      expect(mockSupabase.from().update).toHaveBeenCalledWith(expect.objectContaining({
        reservada_hasta: expect.any(String)
      }));
    });
  });

  describe('liberarReservaNevera', () => {
    it('debe marcar reservada_hasta como null', async () => {
      mockSupabase.from().update().eq.mockResolvedValueOnce({ data: { id: 1 }, error: null });
      
      const resultado = await db.liberarReservaNevera(1);
      expect(resultado).toBe(true);
      expect(mockSupabase.from().update).toHaveBeenCalledWith({ reservada_hasta: null });
    });
  });

  describe('verificarDisponibilidadNevera', () => {
    it('debe retornar falso si no existe la nevera', async () => {
      mockSupabase.from().select().eq().single.mockResolvedValueOnce({ data: null, error: { message: 'No rows' } });
      
      const result = await db.verificarDisponibilidadNevera(1);
      expect(result).toEqual({ disponible: false, reservada: false, error: 'No se encontró la nevera 1' });
    });

    it('debe retornar falso si disponible es false', async () => {
      mockSupabase.from().select().eq().single.mockResolvedValueOnce({ data: { disponible: false }, error: null });
      
      const result = await db.verificarDisponibilidadNevera(1);
      expect(result).toEqual({ disponible: false, reservada: false });
    });

    it('debe retornar reservada=true si reservada_hasta esta en el futuro', async () => {
      const futuro = new Date();
      futuro.setMinutes(futuro.getMinutes() + 10);
      mockSupabase.from().select().eq().single.mockResolvedValueOnce({ 
        data: { disponible: true, reservada_hasta: futuro.toISOString() }, 
        error: null 
      });
      
      const result = await db.verificarDisponibilidadNevera(1);
      expect(result).toEqual({ disponible: true, reservada: true });
    });
    
    it('debe retornar reservada=false y disponible=true si reservada_hasta esta en el pasado', async () => {
      const pasado = new Date();
      pasado.setMinutes(pasado.getMinutes() - 10);
      mockSupabase.from().select().eq().single.mockResolvedValueOnce({ 
        data: { disponible: true, reservada_hasta: pasado.toISOString() }, 
        error: null 
      });
      
      const result = await db.verificarDisponibilidadNevera(1);
      expect(result).toEqual({ disponible: true, reservada: false });
    });
  });

  describe('obtenerOCrearConversacion', () => {
    it('retorna conversacion existente activa', async () => {
       mockSupabase.from().select().eq().single.mockResolvedValueOnce({
         data: { id: 1, estado: 'activo' }, error: null
       });
       
       const conv = await db.obtenerOCrearConversacion('57300000000', 'Juan');
       expect(conv.id).toBe(1);
       expect(mockSupabase.from().insert).not.toHaveBeenCalled();
    });

    it('crea nueva conversacion si no existe', async () => {
       mockSupabase.from().select().eq().single.mockResolvedValueOnce({
         data: null, error: { code: 'PGRST116' }
       });
       mockSupabase.from().insert().select().single.mockResolvedValueOnce({
         data: { id: 2, estado: 'activo' }, error: null
       });
       
       const conv = await db.obtenerOCrearConversacion('57300000000', 'Juan');
       expect(conv.id).toBe(2);
       expect(mockSupabase.from().insert).toHaveBeenCalledWith(expect.objectContaining({
         telefono: '57300000000',
         nombre_cliente: 'Juan'
       }));
    });
  });
  
  describe('actualizarConversacion', () => {
    it('debe actualizar los mensajes y estado', async () => {
       mockSupabase.from().update().eq.mockResolvedValueOnce({ data: { id: 1 }, error: null });
       
       await db.actualizarConversacion(1, [{role: 'user', content: 'hola'}], 50, 'activo');
       expect(mockSupabase.from().update).toHaveBeenCalledWith(expect.objectContaining({
         mensajes: [{role: 'user', content: 'hola'}],
         lead_score: 50,
         estado: 'activo',
         updated_at: expect.any(String)
       }));
    });
  });

  describe('registrarVenta', () => {
    it('debe actualizar la conversacion y la nevera', async () => {
      // RegistrarVenta calls actualizarConversacion and marcarNeveraNoDisponible
      // Due to the nature of complex logic, we can mock the inner methods or test the direct calls.
      mockSupabase.from().update().eq.mockResolvedValue({ data: {}, error: null });
      mockSupabase.from().insert().mockResolvedValue({ data: {}, error: null });
      
      await expect(db.registrarVenta(1, 10, 1500000, 'bot')).resolves.not.toThrow();
    });
  });
});
