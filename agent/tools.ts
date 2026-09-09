import { Type, FunctionDeclaration } from '@google/genai';

export const agentTools: FunctionDeclaration[] = [
  {
    name: 'read_current_note',
    description: 'Lee el contenido de la nota que está abierta actualmente en Obsidian para que el agente sepa qué está leyendo el usuario.',
  },
  {
    name: 'query_vault',
    description: 'Busca un término específico en todas las minutas y planes de acción guardados en la bóveda de Obsidian.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Término o frase a buscar' }
      },
      required: ['query']
    }
  },
  {
    name: 'add_domain_mapping',
    description: 'Añade un mapeo local entre un dominio web y el nombre de un cliente (ej: acme.com -> Acme Corp).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        domain: { type: Type.STRING, description: 'Dominio web sin @' },
        company: { type: Type.STRING, description: 'Nombre del cliente/empresa' }
      },
      required: ['domain', 'company']
    }
  },
  {
    name: 'inject_participants',
    description: 'Fuerza manualmente la lista de participantes (overrides) en una grabación de Fathom específica.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        recording_id: { type: Type.STRING, description: 'ID de la grabación de Fathom' },
        participants: { type: Type.STRING, description: 'Lista de participantes separados por coma (ej: Juan, Maria)' }
      },
      required: ['recording_id', 'participants']
    }
  },
  {
    name: 'trigger_fathom_sync',
    description: 'Lanza el proceso de sincronización de Fathom Notebook para descargar y procesar las últimas reuniones.',
  }
];
