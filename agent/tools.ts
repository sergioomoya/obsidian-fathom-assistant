import { Type, FunctionDeclaration } from '@google/genai';

export const agentTools: FunctionDeclaration[] = [
  // ─── LECTURA Y CONTEXTO DE OBSIDIAN ───
  {
    name: 'read_current_note',
    description: 'Lee el contenido de la nota que está abierta actualmente en Obsidian para que el asistente sepa qué está leyendo el usuario.',
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

  // ─── GESTIÓN DE PLANES DE ACCIÓN (PDA) Y ACUERDOS ───
  {
    name: 'get_client_pda',
    description: 'Consulta las tareas y acuerdos registrados en el Plan de Acción (PDA) de un cliente con filtros por estado o responsable.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        client: { type: Type.STRING, description: 'Nombre del cliente (ej: CARAMELOS CERDAN, BASOR)' },
        status: { type: Type.STRING, description: 'Filtro opcional de estado: pending (pendientes), done (completadas), all (todas)' },
        assignee: { type: Type.STRING, description: 'Nombre opcional del responsable para filtrar sus tareas' }
      },
      required: ['client']
    }
  },
  {
    name: 'add_pda_action',
    description: 'Añade una nueva tarea o acuerdo al Plan de Acción (PDA) de un cliente.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        client: { type: Type.STRING, description: 'Nombre del cliente' },
        task: { type: Type.STRING, description: 'Descripción clara de la tarea o acción a realizar' },
        assignee: { type: Type.STRING, description: 'Persona responsable asignada' },
        priority: { type: Type.STRING, description: 'Prioridad: 🟢 Baja, 🟡 Media, 🔴 Alta' },
        deadline: { type: Type.STRING, description: 'Fecha límite estimada (ej: 2026-09-30)' }
      },
      required: ['client', 'task']
    }
  },
  {
    name: 'complete_pda_action',
    description: 'Marca como completada una tarea existente en el Plan de Acción (PDA) de un cliente.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        client: { type: Type.STRING, description: 'Nombre del cliente' },
        query_or_id: { type: Type.STRING, description: 'ID de la tarea o fragmento del texto de la tarea para identificarla' }
      },
      required: ['client', 'query_or_id']
    }
  },

  // ─── CONSULTAS DE REUNIONES Y MINUTAS DE FATHOM ───
  {
    name: 'list_recent_meetings',
    description: 'Lista las reuniones de Fathom archivadas en la bóveda ordenadas por fecha más reciente.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        client: { type: Type.STRING, description: 'Nombre opcional del cliente para ver solo sus reuniones' },
        limit: { type: Type.NUMBER, description: 'Número máximo de reuniones a listar (por defecto 5)' }
      }
    }
  },
  {
    name: 'get_meeting_summary',
    description: 'Obtiene el resumen ejecutivo, acuerdos y temas clave de una reunión específica o de la última reunión de un cliente.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        client: { type: Type.STRING, description: 'Nombre del cliente' },
        meeting_id_or_date: { type: Type.STRING, description: 'ID de la carpeta de la reunión, fecha YYYY-MM-DD o "latest" para la más reciente' }
      },
      required: ['client']
    }
  },
  {
    name: 'search_meeting_transcripts',
    description: 'Busca menciones o discusiones específicas dentro de las transcripciones de reuniones de Fathom.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Frase o término a buscar en las conversaciones' },
        client: { type: Type.STRING, description: 'Nombre opcional del cliente para limitar la búsqueda' }
      },
      required: ['query']
    }
  },

  // ─── ACCIONES DEL BACKEND DE FATHOM NOTEBOOK ───
  {
    name: 'trigger_fathom_sync',
    description: 'Lanza el proceso de sincronización de Fathom Notebook para descargar y procesar las últimas reuniones grabadas.',
  },
  {
    name: 'reprocess_meetings',
    description: 'Reprocesa reuniones existentes en Fathom Notebook para regenerar sus minutas o acciones.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        args: { type: Type.STRING, description: 'Parámetros para el CLI (ej: --client BASOR o ID de reunión)' }
      }
    }
  },
  {
    name: 'add_domain_mapping',
    description: 'Añade un mapeo entre un dominio web y el nombre de un cliente (ej: acme.com -> Acme Corp) para asignación automática de reuniones.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        domain: { type: Type.STRING, description: 'Dominio web sin @ (ej: mesbook.com)' },
        company: { type: Type.STRING, description: 'Nombre canónico del cliente' }
      },
      required: ['domain', 'company']
    }
  },
  {
    name: 'inject_participants',
    description: 'Fuerza manualmente la lista de participantes en una grabación de Fathom específica.',
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
    name: 'run_fathom_cli',
    description: 'Ejecuta un comando CLI personalizado en el backend de Fathom Notebook.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        subcommand: { type: Type.STRING, description: 'Subcomando y argumentos para el CLI' }
      },
      required: ['subcommand']
    }
  },

  // ─── GOBERNANZA Y PLANIFICACIÓN ───
  {
    name: 'request_user_permission',
    description: 'Solicita permiso explícito al usuario en el chat antes de ejecutar una acción sensible o destructiva.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action_title: { type: Type.STRING, description: 'Título claro de la acción' },
        action_details: { type: Type.STRING, description: 'Detalle exacto del cambio a realizar' },
        danger_level: { type: Type.STRING, description: 'Nivel de riesgo: low, medium, high' }
      },
      required: ['action_title', 'action_details']
    }
  },
  {
    name: 'propose_implementation_plan',
    description: 'Presenta un plan de implementación o checklist interactivo al usuario en el chat para tareas complejas.',
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
  }
];
