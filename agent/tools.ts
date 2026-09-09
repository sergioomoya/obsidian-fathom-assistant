import { Type, FunctionDeclaration } from '@google/genai';

export const agentTools: FunctionDeclaration[] = [
  {
    name: 'read_current_note',
    description: 'Lee el contenido de la nota que está abierta actualmente en Obsidian para que el agente sepa qué está leyendo el usuario.',
  },
  {
    name: 'read_vault_note',
    description: 'Lee el contenido completo de una nota dentro de la bóveda de Obsidian especificando su ruta o nombre (ej: "CLIENTE/Minutas/Reunion.md" o "minutas.md").',
    parameters: {
      type: Type.OBJECT,
      properties: {
        note_path: { type: Type.STRING, description: 'Ruta relativa o nombre de la nota en la bóveda de Obsidian' }
      },
      required: ['note_path']
    }
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
    name: 'read_local_file',
    description: 'Lee el contenido de cualquier archivo o documento en el equipo mediante su ruta absoluta o relativa.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        file_path: { type: Type.STRING, description: 'Ruta completa del archivo en el sistema de archivos (ej: C:\\...\\archivo.txt o ./config.json)' }
      },
      required: ['file_path']
    }
  },
  {
    name: 'request_user_permission',
    description: 'Solicita permiso explícito al usuario en el chat antes de ejecutar una acción sensible, destructiva o de alto impacto (ej: modificar bases de datos SQL, sobreescribir archivos críticos o alterar configuraciones).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action_title: { type: Type.STRING, description: 'Título claro de la acción para la que se pide permiso (ej: Ejecutar UPDATE en base de datos BASOR)' },
        action_details: { type: Type.STRING, description: 'Detalle exacto del comando, query o cambio que se va a realizar' },
        danger_level: { type: Type.STRING, description: 'Nivel de riesgo: low, medium, high' }
      },
      required: ['action_title', 'action_details']
    }
  },
  {
    name: 'propose_implementation_plan',
    description: 'Presenta un plan de implementación o checklist interactivo al usuario en el chat para tareas complejas antes de ejecutarlas.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: 'Título del plan de implementación' },
        summary: { type: Type.STRING, description: 'Resumen del objetivo del plan' },
        steps: { 
          type: Type.ARRAY, 
          items: { type: Type.STRING },
          description: 'Lista ordenada de pasos a ejecutar' 
        }
      },
      required: ['title', 'steps']
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
