import { App, TFile } from 'obsidian';

export const SMARTLIST_BLOCK_REGEX = /```smartlist\s*([\s\S]*?)\s*```/;

export interface PdaRow {
  _id?: string;
  session_date?: string | { text: string; tooltip?: string };
  task?: string;
  status?: string;
  priority?: string;
  responsible?: string | string[];
  dependencies?: string;
  deliverables?: string;
  deadline?: string;
  comments?: string;
}

export interface SmartlistTable {
  id?: string;
  title?: string;
  columns?: any[];
  rows?: PdaRow[];
}

export class PdaManager {
  constructor(private app: App) {}

  /**
   * Localiza el archivo PDA de un cliente en la bóveda de Obsidian.
   */
  findPdaFile(client: string): TFile | null {
    const cleanClient = client.trim().toLowerCase();
    const allFiles = this.app.vault.getMarkdownFiles();

    // 1. Coincidencia exacta: "PDA <CLIENTE>.md"
    let file = allFiles.find(f => {
      const base = f.basename.toLowerCase();
      return base === `pda ${cleanClient}` || base === `pda_${cleanClient}` || base === `pda-${cleanClient}`;
    });

    if (file) return file;

    // 2. Buscar archivo que empiece por PDA dentro de una carpeta cuyo nombre coincida con el cliente
    file = allFiles.find(f => {
      const parts = f.path.toLowerCase().split(/[\\/]/);
      return parts.some(p => p.includes(cleanClient)) && f.basename.toLowerCase().startsWith('pda');
    });

    if (file) return file;

    // 3. Fallback: coincidencia parcial en el nombre del PDA
    return allFiles.find(f => f.basename.toLowerCase().startsWith('pda') && f.basename.toLowerCase().includes(cleanClient)) || null;
  }

  /**
   * Extrae y parsea el contenido del bloque smartlist del PDA.
   */
  async getPdaData(file: TFile): Promise<{ rawContent: string; table: SmartlistTable | null }> {
    const rawContent = await this.app.vault.read(file);
    const match = rawContent.match(SMARTLIST_BLOCK_REGEX);
    if (!match) {
      return { rawContent, table: null };
    }

    try {
      const table: SmartlistTable = JSON.parse(match[1]);
      return { rawContent, table };
    } catch (err) {
      console.error(`[PdaManager] Error parseando JSON de smartlist en ${file.path}:`, err);
      return { rawContent, table: null };
    }
  }

  /**
   * Obtiene y filtra las filas del PDA para presentarlas al modelo en texto formateado.
   */
  async getClientActions(client: string, filter?: { status?: string; assignee?: string }): Promise<string> {
    const file = this.findPdaFile(client);
    if (!file) {
      return `No se encontró ningún archivo de Plan de Acción (PDA) para el cliente '${client}' en la bóveda.`;
    }

    const { table } = await this.getPdaData(file);
    if (!table || !Array.isArray(table.rows) || table.rows.length === 0) {
      return `El Plan de Acción de '${client}' (${file.path}) no contiene ninguna tarea registrada.`;
    }

    let rows = table.rows;

    // Filtro por estado
    if (filter?.status) {
      const s = filter.status.toLowerCase();
      if (s === 'pending' || s === 'pendiente') {
        rows = rows.filter(r => {
          const st = (r.status || '').toLowerCase();
          return st.includes('pendiente') || st.includes('en progreso') || !st;
        });
      } else if (s === 'done' || s === 'completado') {
        rows = rows.filter(r => (r.status || '').toLowerCase().includes('completado'));
      } else if (s !== 'all' && s !== 'todos') {
        rows = rows.filter(r => (r.status || '').toLowerCase().includes(s));
      }
    }

    // Filtro por responsable
    if (filter?.assignee) {
      const a = filter.assignee.toLowerCase();
      rows = rows.filter(r => {
        const resp = Array.isArray(r.responsible) ? r.responsible.join(', ') : (r.responsible || '');
        return resp.toLowerCase().includes(a);
      });
    }

    if (rows.length === 0) {
      return `Plan de Acción de '${client}' (${file.path}): No se encontraron tareas que coincidan con los filtros aplicados.`;
    }

    const formattedRows = rows.map((r, idx) => {
      const date = typeof r.session_date === 'object' ? r.session_date.text : (r.session_date || 'Sin fecha');
      const resp = Array.isArray(r.responsible) ? r.responsible.join(', ') : (r.responsible || 'Sin asignar');
      const status = r.status || 'Pendiente';
      const priority = r.priority ? ` | Prioridad: ${r.priority}` : '';
      const deadline = r.deadline ? ` | Límite: ${r.deadline}` : '';
      const comments = r.comments ? ` | Nota: ${r.comments}` : '';

      return `${idx + 1}. **[${status}]** ${r.task || 'Sin descripción'}\n   - Responsable: ${resp} | Sesión: ${date}${priority}${deadline}${comments}`;
    }).join('\n\n');

    return `### Plan de Acción — ${client.toUpperCase()} (${file.path})\nTotal tareas mostradas: ${rows.length}\n\n${formattedRows}`;
  }

  /**
   * Añade una nueva acción al PDA de un cliente.
   */
  async addAction(
    client: string, 
    task: string, 
    assignee?: string, 
    priority: string = '🟡 Media', 
    deadline?: string
  ): Promise<{ success: boolean; message: string }> {
    const file = this.findPdaFile(client);
    if (!file) {
      return { success: false, message: `No se encontró el archivo PDA para '${client}'.` };
    }

    const { rawContent, table } = await this.getPdaData(file);
    if (!table) {
      return { success: false, message: `El archivo ${file.path} no contiene un bloque smartlist válido.` };
    }

    if (!Array.isArray(table.rows)) {
      table.rows = [];
    }

    const todayStr = new Date().toISOString().substring(0, 10);
    const newId = `r_act_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    const newRow: PdaRow = {
      _id: newId,
      session_date: {
        text: todayStr,
        tooltip: 'Añadido desde Fathom Assistant'
      },
      task: task.trim(),
      status: 'Pendiente',
      priority: priority.trim(),
      responsible: assignee ? assignee.trim() : 'Sin asignar',
      deadline: deadline ? deadline.trim() : ''
    };

    table.rows.unshift(newRow);

    const updatedBlock = '```smartlist\n' + JSON.stringify(table, null, 2) + '\n```';
    const newContent = rawContent.replace(SMARTLIST_BLOCK_REGEX, () => updatedBlock);

    await this.app.vault.modify(file, newContent);
    return {
      success: true,
      message: `Tarea añadida con éxito al PDA de '${client}': "${task}" (Responsable: ${newRow.responsible})`
    };
  }

  /**
   * Actualiza el estado de una tarea existente en el PDA de un cliente.
   */
  async updateActionStatus(
    client: string, 
    queryOrId: string, 
    newStatus: string = 'Completado'
  ): Promise<{ success: boolean; message: string; updatedTask?: string }> {
    const file = this.findPdaFile(client);
    if (!file) {
      return { success: false, message: `No se encontró el archivo PDA para '${client}'.` };
    }

    const { rawContent, table } = await this.getPdaData(file);
    if (!table || !Array.isArray(table.rows) || table.rows.length === 0) {
      return { success: false, message: `No hay tareas en el PDA de '${client}'.` };
    }

    const q = queryOrId.toLowerCase().trim();
    const targetRow = table.rows.find(r => 
      (r._id && r._id.toLowerCase() === q) || 
      (r.task && r.task.toLowerCase().includes(q))
    );

    if (!targetRow) {
      return { success: false, message: `No se encontró ninguna tarea que coincida con '${queryOrId}' en el PDA de '${client}'.` };
    }

    const oldStatus = targetRow.status || 'Pendiente';
    targetRow.status = newStatus;

    const updatedBlock = '```smartlist\n' + JSON.stringify(table, null, 2) + '\n```';
    const newContent = rawContent.replace(SMARTLIST_BLOCK_REGEX, () => updatedBlock);

    await this.app.vault.modify(file, newContent);
    return {
      success: true,
      message: `Tarea actualizada en el PDA de '${client}': de [${oldStatus}] a [${newStatus}] para "${targetRow.task}"`,
      updatedTask: targetRow.task
    };
  }
}
