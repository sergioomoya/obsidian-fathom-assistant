import { Type, FunctionDeclaration } from '@google/genai';

export const agentTools: FunctionDeclaration[] = [
  {
    name: 'read_current_note',
    description: 'Lee el contenido de la nota que está abierta actualmente en Obsidian para que el agente sepa qué está leyendo el usuario.',
  },
  {
    name: 'query_vault',
    description: 'Busca notas y archivos por nombre o contenido en la bóveda de Obsidian.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Término o frase a buscar en las notas' }
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
  },
  {
    name: 'reprocess_meetings',
    description: 'Reprocesa reuniones existentes en Fathom Notebook para regenerar sus minutas.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        args: { type: Type.STRING, description: 'Parámetros opcionales para el reprocesamiento (ej: --all, o un ID específico)' }
      }
    }
  },
  {
    name: 'run_fathom_cli',
    description: 'Ejecuta un comando CLI en el backend de Fathom Notebook.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        subcommand: { type: Type.STRING, description: 'Subcomando y argumentos para el CLI (ej: sync, add-mapping dominio empresa)' }
      },
      required: ['subcommand']
    }
  }
];
