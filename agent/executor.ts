import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, existsSync } from 'node:fs';
import { App, TFile, TFolder } from 'obsidian';
import { PdaManager, SMARTLIST_BLOCK_REGEX } from './pda-manager';

const execAsync = promisify(exec);

export interface ToolExecutionMeta {
  group: 'files' | 'commands';
  displayTitle: string;
  commandSnippet?: string;
  resultSummary?: string;
}

export interface ToolExecutionResult {
  textResult: string;
  meta: ToolExecutionMeta;
}

export type PermissionDecision = 'approved' | 'always' | 'rejected';

export interface InteractiveHandlers {
  onRequestPermission?: (title: string, details: string, dangerLevel: string, permissionKey: string) => Promise<PermissionDecision>;
  onProposePlan?: (title: string, summary: string, steps: string[]) => Promise<'approved' | 'rejected'>;
  onAlwaysAllow?: (permissionKey: string) => Promise<void>;
  alwaysAllowedPermissions?: string[];
}

/**
 * Encargado de ejecutar físicamente las llamadas a herramientas que el LLM decide invocar.
 */
export class ToolExecutor {
  private pdaManager: PdaManager;

  constructor(
    private app: App, 
    private fathomRepoPath: string,
    private handlers?: InteractiveHandlers
  ) {
    this.pdaManager = new PdaManager(app);
  }

  /**
   * Obtiene los metadatos visuales de la herramienta ANTES de ejecutarla (para pintar la tarjeta en vivo).
   */
  getToolMeta(name: string, args: Record<string, any>): ToolExecutionMeta {
    switch (name) {
      case 'read_current_note': {
        const file = this.app.workspace.getActiveFile();
        const noteName = file ? file.basename : 'nota actual';
        return {
          group: 'files',
          displayTitle: `Read ${noteName}.md`
        };
      }
      case 'read_vault_note': {
        const notePath = args.note_path || '';
        const noteName = notePath.split(/[\\/]/).pop() || notePath;
        return {
          group: 'files',
          displayTitle: `Read ${noteName}`
        };
      }
      case 'query_vault': {
        const query = args.query || '';
        return {
          group: 'files',
          displayTitle: `Search vault for "${query}"`
        };
      }
      case 'read_local_file': {
        const filePath = args.file_path || '';
        const fileName = filePath.split(/[\\/]/).pop() || filePath;
        return {
          group: 'files',
          displayTitle: `Read ${fileName}`
        };
      }
      case 'get_client_pda': {
        const client = args.client || 'Client';
        return {
          group: 'files',
          displayTitle: `Read PDA: ${client}`
        };
      }
      case 'add_pda_action': {
        const client = args.client || 'Client';
        return {
          group: 'commands',
          displayTitle: `Add action to PDA: ${client}`
        };
      }
      case 'complete_pda_action': {
        const client = args.client || 'Client';
        return {
          group: 'commands',
          displayTitle: `Complete action in PDA: ${client}`
        };
      }
      case 'list_recent_meetings': {
        const client = args.client ? ` (${args.client})` : '';
        return {
          group: 'files',
          displayTitle: `List meetings${client}`
        };
      }
      case 'get_meeting_summary': {
        const client = args.client || 'Client';
        return {
          group: 'files',
          displayTitle: `Summary: ${client} meeting`
        };
      }
      case 'search_meeting_transcripts': {
        const query = args.query || '';
        return {
          group: 'files',
          displayTitle: `Search transcripts: "${query}"`
        };
      }
      case 'request_user_permission': {
        return {
          group: 'commands',
          displayTitle: `Permission Request: ${args.action_title || 'Action'}`
        };
      }
      case 'propose_implementation_plan': {
        return {
          group: 'commands',
          displayTitle: `Plan: ${args.title || 'Implementation'}`
        };
      }
      case 'add_domain_mapping': {
        const cmd = `npm run cli add-mapping "${args.domain}" "${args.company}"`;
        return {
          group: 'commands',
          displayTitle: `Ran ${cmd}`,
          commandSnippet: cmd
        };
      }
      case 'inject_participants': {
        const cmd = `npm run cli add-override "${args.recording_id}" "${args.participants}"`;
        return {
          group: 'commands',
          displayTitle: `Ran ${cmd}`,
          commandSnippet: cmd
        };
      }
      case 'trigger_fathom_sync': {
        const cmd = `npm run cli sync`;
        return {
          group: 'commands',
          displayTitle: `Ran ${cmd}`,
          commandSnippet: cmd
        };
      }
      case 'reprocess_meetings': {
        const cmd = `npm run cli reprocess ${args.args || ''}`.trim();
        return {
          group: 'commands',
          displayTitle: `Ran ${cmd}`,
          commandSnippet: cmd
        };
      }
      case 'run_fathom_cli': {
        const cmd = `npm run cli ${args.subcommand || ''}`.trim();
        return {
          group: 'commands',
          displayTitle: `Ran ${cmd}`,
          commandSnippet: cmd
        };
      }
      default: {
        return {
          group: 'commands',
          displayTitle: `Execute tool: ${name}`
        };
      }
    }
  }

  /**
   * Ejecuta la herramienta solicitada y devuelve el resultado en texto junto a sus metadatos.
   */
  async execute(name: string, args: Record<string, any>, signal?: AbortSignal): Promise<ToolExecutionResult> {
    const meta = this.getToolMeta(name, args);
    try {
      switch (name) {
        // ─── LECTURA BÁSICA ───
        case 'read_current_note': {
          const file = this.app.workspace.getActiveFile();
          if (!file) {
            meta.resultSummary = 'No hay nota activa';
            return { textResult: 'No hay ninguna nota abierta actualmente.', meta };
          }
          const content = await this.app.vault.read(file);
          meta.resultSummary = `${content.length} caracteres`;
          return { textResult: `Contenido de la nota actual (${file.basename}):\n\n${content}`, meta };
        }

        case 'read_vault_note': {
          const { note_path } = args;
          if (!note_path) {
            meta.resultSummary = 'Ruta no especificada';
            return { textResult: 'Error: No se indicó ninguna ruta de nota.', meta };
          }
          const cleanPath = String(note_path).replace(/^[\\/]/, '');
          let vaultFile = this.app.vault.getAbstractFileByPath(cleanPath) || this.app.vault.getAbstractFileByPath(cleanPath + '.md');
          
          if (!vaultFile) {
            const fileNameOnly = cleanPath.split(/[\\/]/).pop() || cleanPath;
            const baseNameOnly = fileNameOnly.replace(/\.md$/i, '');
            const allFiles = this.app.vault.getMarkdownFiles();
            vaultFile = allFiles.find(f => 
              f.name.toLowerCase() === fileNameOnly.toLowerCase() ||
              f.basename.toLowerCase() === baseNameOnly.toLowerCase() ||
              f.path.toLowerCase().endsWith(cleanPath.toLowerCase())
            ) || null;
          }

          if (vaultFile && vaultFile instanceof TFile) {
            const content = await this.app.vault.read(vaultFile);
            meta.resultSummary = `${content.length} caracteres`;
            return { textResult: `Contenido de la nota (${vaultFile.path}):\n\n${content}`, meta };
          }

          meta.resultSummary = 'Nota no encontrada';
          return { textResult: `Error: No se encontró la nota '${note_path}' en la bóveda de Obsidian.`, meta };
        }

        case 'query_vault': {
          const rawQuery = String(args.query || '').trim();
          const query = rawQuery.toLowerCase();
          const files = this.app.vault.getMarkdownFiles();
          
          const pathMatches = files.filter(f => f.path.toLowerCase().includes(query) || f.basename.toLowerCase().includes(query));
          if (pathMatches.length > 0) {
            meta.resultSummary = `${pathMatches.length} nota(s)`;
            return {
              textResult: `Notas encontradas por nombre/ruta para '${rawQuery}':\n` + pathMatches.slice(0, 30).map(m => `- ${m.path}`).join('\n') + (pathMatches.length > 30 ? `\n... y ${pathMatches.length - 30} notas más.` : ''),
              meta
            };
          }

          const contentMatches: { path: string, snippet: string }[] = [];
          for (const file of files) {
            try {
              const content = await this.app.vault.read(file);
              const idx = content.toLowerCase().indexOf(query);
              if (idx !== -1) {
                const start = Math.max(0, idx - 60);
                const end = Math.min(content.length, idx + query.length + 60);
                const snippet = content.substring(start, end).replace(/[\r\n]+/g, ' ');
                contentMatches.push({ path: file.path, snippet: `...${snippet}...` });
                if (contentMatches.length >= 15) break;
              }
            } catch (e) {}
          }

          meta.resultSummary = `${contentMatches.length} nota(s)`;
          if (contentMatches.length === 0) {
            return { textResult: `No se encontraron notas en la bóveda que contengan '${rawQuery}'.`, meta };
          }

          return {
            textResult: `Notas con contenido que coincide con '${rawQuery}':\n` + contentMatches.map(m => `- **${m.path}**: ${m.snippet}`).join('\n'),
            meta
          };
        }

        case 'read_local_file': {
          const { file_path } = args;
          if (!file_path) {
            meta.resultSummary = 'Ruta vacía';
            return { textResult: 'Error: No se especificó ninguna ruta de archivo.', meta };
          }

          if (existsSync(file_path)) {
            try {
              const content = readFileSync(file_path, 'utf-8');
              meta.resultSummary = `${content.length} bytes`;
              return { textResult: `Contenido de ${file_path}:\n\n${content}`, meta };
            } catch (err: any) {
              meta.resultSummary = 'Error de lectura';
              return { textResult: `Error leyendo archivo: ${err.message}`, meta };
            }
          }

          const cleanPath = String(file_path).replace(/^[\\/]/, '');
          let vaultFile = this.app.vault.getAbstractFileByPath(cleanPath) || this.app.vault.getAbstractFileByPath(cleanPath + '.md');
          
          if (!vaultFile) {
            const fileNameOnly = cleanPath.split(/[\\/]/).pop() || cleanPath;
            const baseNameOnly = fileNameOnly.replace(/\.md$/i, '');
            const allFiles = this.app.vault.getMarkdownFiles();
            vaultFile = allFiles.find(f => 
              f.name.toLowerCase() === fileNameOnly.toLowerCase() ||
              f.basename.toLowerCase() === baseNameOnly.toLowerCase() ||
              f.path.toLowerCase().endsWith(cleanPath.toLowerCase())
            ) || null;
          }

          if (vaultFile && vaultFile instanceof TFile) {
            const content = await this.app.vault.read(vaultFile);
            meta.resultSummary = `${content.length} caracteres`;
            return { textResult: `Contenido de la nota (${vaultFile.path}):\n\n${content}`, meta };
          }

          meta.resultSummary = 'Archivo no encontrado';
          return { textResult: `Error: El archivo '${file_path}' no existe en el sistema de archivos ni en la bóveda de Obsidian.`, meta };
        }

        // ─── GESTIÓN DE PLANES DE ACCIÓN (PDA) ───
        case 'get_client_pda': {
          const { client, status, assignee } = args;
          const result = await this.pdaManager.getClientActions(client, { status, assignee });
          meta.resultSummary = result.includes('### Plan de Acción') ? 'PDA consultado' : 'Sin tareas';
          return { textResult: result, meta };
        }

        case 'add_pda_action': {
          const { client, task, assignee, priority, deadline } = args;
          const res = await this.pdaManager.addAction(client, task, assignee, priority, deadline);
          meta.resultSummary = res.success ? 'Acción añadida' : 'Error';
          return { textResult: res.message, meta };
        }

        case 'complete_pda_action': {
          const { client, query_or_id } = args;
          const res = await this.pdaManager.updateActionStatus(client, query_or_id, 'Completado');
          meta.resultSummary = res.success ? 'Acción completada' : 'No encontrada';
          return { textResult: res.message, meta };
        }

        // ─── CONSULTAS DE REUNIONES Y MINUTAS DE FATHOM ───
        case 'list_recent_meetings': {
          const { client, limit = 5 } = args;
          const result = await this.listRecentMeetings(client, Number(limit));
          meta.resultSummary = `${result.count} reuniones`;
          return { textResult: result.text, meta };
        }

        case 'get_meeting_summary': {
          const { client, meeting_id_or_date } = args;
          const result = await this.getMeetingSummary(client, meeting_id_or_date);
          meta.resultSummary = result.found ? 'Minuta leída' : 'No encontrada';
          return { textResult: result.text, meta };
        }

        case 'search_meeting_transcripts': {
          const { query, client } = args;
          const result = await this.searchTranscripts(query, client);
          meta.resultSummary = `${result.matchesCount} mención(es)`;
          return { textResult: result.text, meta };
        }

        // ─── GOBERNANZA Y PLANIFICACIÓN ───
        case 'request_user_permission': {
          const { action_title, action_details, danger_level = 'medium' } = args;
          const permissionKey = `perm_${action_title.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`;

          if (this.handlers?.alwaysAllowedPermissions?.includes(permissionKey)) {
            meta.resultSummary = 'Permiso concedido previamente (Aprobado siempre)';
            return { textResult: `Permiso concedido automáticamente por regla persistente del usuario para: ${action_title}`, meta };
          }

          if (this.handlers?.onRequestPermission) {
            const decision = await this.handlers.onRequestPermission(action_title, action_details, danger_level, permissionKey);
            if (decision === 'always') {
              if (this.handlers.onAlwaysAllow) {
                await this.handlers.onAlwaysAllow(permissionKey);
              }
              meta.resultSummary = 'Permiso concedido permanentemente';
              return { textResult: `El usuario ha APROBADO SIEMPRE la acción: ${action_title}. Puedes proceder ahora y en el futuro.`, meta };
            } else if (decision === 'approved') {
              meta.resultSummary = 'Permiso concedido (una vez)';
              return { textResult: `El usuario ha APROBADO la acción: ${action_title}. Puedes proceder.`, meta };
            } else {
              meta.resultSummary = 'Permiso denegado por el usuario';
              return { textResult: `El usuario ha RECHAZADO la acción: ${action_title}. No ejecutes esta acción y busca una alternativa.`, meta };
            }
          }
          meta.resultSummary = 'Permiso concedido por defecto';
          return { textResult: 'Permiso concedido.', meta };
        }

        case 'propose_implementation_plan': {
          const { title, summary = '', steps = [] } = args;
          if (this.handlers?.onProposePlan) {
            const decision = await this.handlers.onProposePlan(title, summary, steps);
            if (decision === 'approved') {
              meta.resultSummary = 'Plan aprobado por el usuario';
              return { textResult: `El usuario ha APROBADO el plan '${title}'. Procede a ejecutar los pasos paso a paso.`, meta };
            } else {
              meta.resultSummary = 'Plan rechazado por el usuario';
              return { textResult: `El usuario ha RECHAZADO o pedido cambios en el plan '${title}'. Pide aclaraciones antes de continuar.`, meta };
            }
          }
          meta.resultSummary = 'Plan presentado';
          return { textResult: `Plan '${title}' presentado al usuario.`, meta };
        }

        // ─── ACCIONES DEL BACKEND DE FATHOM NOTEBOOK ───
        case 'add_domain_mapping': {
          const { domain, company } = args;
          const output = await this.runCliCommand(`npm run cli add-mapping "${domain}" "${company}"`, signal);
          meta.resultSummary = 'Mapeo guardado';
          return { textResult: output, meta };
        }

        case 'inject_participants': {
          const { recording_id, participants } = args;
          const output = await this.runCliCommand(`npm run cli add-override "${recording_id}" "${participants}"`, signal);
          meta.resultSummary = 'Override aplicado';
          return { textResult: output, meta };
        }

        case 'trigger_fathom_sync': {
          const output = await this.runCliCommand(`npm run cli sync`, signal);
          meta.resultSummary = 'Sincronización completada';
          return { textResult: output, meta };
        }

        case 'reprocess_meetings': {
          const output = await this.runCliCommand(`npm run cli reprocess ${args.args || ''}`.trim(), signal);
          meta.resultSummary = 'Reprocesamiento finalizado';
          return { textResult: output, meta };
        }

        case 'run_fathom_cli': {
          const output = await this.runCliCommand(`npm run cli ${args.subcommand || ''}`.trim(), signal);
          meta.resultSummary = 'Comando ejecutado';
          return { textResult: output, meta };
        }

        default: {
          meta.resultSummary = 'Herramienta desconocida';
          return { textResult: `Error: Herramienta desconocida (${name})`, meta };
        }
      }
    } catch (error: any) {
      meta.resultSummary = `Error: ${error.message}`;
      return { textResult: `Excepción ejecutando herramienta ${name}: ${error.message}`, meta };
    }
  }

  // ─── MÉTODOS DE APOYO PARA REUNIONES Y TRANSCRIPCIONES ───

  private async listRecentMeetings(clientFilter?: string, limit: number = 5): Promise<{ text: string; count: number }> {
    const markdownFiles = this.app.vault.getMarkdownFiles();
    const minutasFiles = markdownFiles.filter(f => f.name.toLowerCase() === 'minutas.md' || f.name.toLowerCase().endsWith('- minutas.md'));

    const meetings: { client: string; meetingName: string; path: string; date: string }[] = [];

    for (const f of minutasFiles) {
      const parts = f.path.split(/[\\/]/);
      // Estructura esperada: CLIENTE/YYYY-MM-DD - Titulo/minutas.md
      if (parts.length >= 3) {
        const clientName = parts[parts.length - 3];
        const meetingFolder = parts[parts.length - 2];
        const dateMatch = meetingFolder.match(/^(\d{4}-\d{2}-\d{2})/);
        const date = dateMatch ? dateMatch[1] : '';

        if (clientFilter) {
          const cleanFilter = clientFilter.toLowerCase().trim();
          if (!clientName.toLowerCase().includes(cleanFilter)) continue;
        }

        meetings.push({
          client: clientName,
          meetingName: meetingFolder,
          path: f.path,
          date
        });
      }
    }

    meetings.sort((a, b) => b.date.localeCompare(a.date));
    const sliced = meetings.slice(0, Math.max(1, limit));

    if (sliced.length === 0) {
      return {
        text: clientFilter 
          ? `No se encontraron reuniones de Fathom archivadas para el cliente '${clientFilter}'.` 
          : 'No se encontraron reuniones de Fathom en la bóveda.',
        count: 0
      };
    }

    const listText = sliced.map((m, i) => `${i + 1}. **${m.date || 'Sin fecha'}** — *${m.client}*: ${m.meetingName} (\`${m.path}\`)`).join('\n');
    return {
      text: `### Reuniones recientes de Fathom (${sliced.length} mostradas):\n\n${listText}`,
      count: sliced.length
    };
  }

  private async getMeetingSummary(client: string, meetingIdOrDate?: string): Promise<{ text: string; found: boolean }> {
    const markdownFiles = this.app.vault.getMarkdownFiles();
    const cleanClient = client.toLowerCase().trim();
    const clientMinutas = markdownFiles.filter(f => {
      const p = f.path.toLowerCase();
      return p.includes(cleanClient) && (f.name.toLowerCase() === 'minutas.md' || f.basename.toLowerCase().includes('minutas'));
    });

    if (clientMinutas.length === 0) {
      return { text: `No se encontraron minutas para el cliente '${client}'.`, found: false };
    }

    // Ordenar de más reciente a más antigua
    clientMinutas.sort((a, b) => b.path.localeCompare(a.path));

    let targetFile = clientMinutas[0];
    if (meetingIdOrDate && meetingIdOrDate.toLowerCase() !== 'latest' && meetingIdOrDate.toLowerCase() !== 'ultima') {
      const targetQuery = meetingIdOrDate.toLowerCase().trim();
      const match = clientMinutas.find(f => f.path.toLowerCase().includes(targetQuery));
      if (match) targetFile = match;
    }

    const rawContent = await this.app.vault.read(targetFile);
    // Limpiar bloque smartlist para dejar solo el resumen ejecutivo y acuerdos
    const cleanContent = rawContent.replace(SMARTLIST_BLOCK_REGEX, '').trim();

    return {
      text: `### Resumen de Minuta — ${targetFile.path}\n\n${cleanContent}`,
      found: true
    };
  }

  private async searchTranscripts(query: string, clientFilter?: string): Promise<{ text: string; matchesCount: number }> {
    const rawQuery = query.toLowerCase().trim();
    const markdownFiles = this.app.vault.getMarkdownFiles();
    const transcripts = markdownFiles.filter(f => {
      const isTranscript = f.name.toLowerCase() === 'transcripcion.md' || f.basename.toLowerCase().includes('transcripci');
      if (!isTranscript) return false;
      if (clientFilter) {
        return f.path.toLowerCase().includes(clientFilter.toLowerCase().trim());
      }
      return true;
    });

    if (transcripts.length === 0) {
      return { text: `No se encontraron archivos de transcripción para buscar.`, matchesCount: 0 };
    }

    const results: { path: string; snippets: string[] }[] = [];
    let totalMatches = 0;

    for (const f of transcripts) {
      try {
        const content = await this.app.vault.read(f);
        const lower = content.toLowerCase();
        let pos = 0;
        const snippets: string[] = [];

        while ((pos = lower.indexOf(rawQuery, pos)) !== -1) {
          totalMatches++;
          const start = Math.max(0, pos - 100);
          const end = Math.min(content.length, pos + rawQuery.length + 100);
          const snippet = content.substring(start, end).replace(/[\r\n]+/g, ' ');
          snippets.push(`"...${snippet}..."`);
          pos += rawQuery.length + 50;
          if (snippets.length >= 3) break;
        }

        if (snippets.length > 0) {
          results.push({ path: f.path, snippets });
          if (results.length >= 10) break;
        }
      } catch (e) {}
    }

    if (results.length === 0) {
      return { text: `No se encontraron menciones de '${query}' en las transcripciones analizadas.`, matchesCount: 0 };
    }

    const output = results.map(r => `#### 📄 ${r.path}\n` + r.snippets.map(s => `- ${s}`).join('\n')).join('\n\n');
    return {
      text: `### Coincidencias en Transcripciones para '${query}':\n\n${output}`,
      matchesCount: totalMatches
    };
  }

  /**
   * Envía un comando a la terminal del sistema host, ejecutándolo en el directorio del backend.
   */
  private async runCliCommand(command: string, signal?: AbortSignal): Promise<string> {
    if (!this.fathomRepoPath) {
      return 'Error fatal: La ruta del repositorio (FATHOM_REPO_PATH) no está configurada en los ajustes del plugin de Obsidian.';
    }
    
    console.log(`[Fathom Assistant] Ejecutando: ${command} en ${this.fathomRepoPath}`);
    try {
      const { stdout, stderr } = await execAsync(command, { 
        cwd: this.fathomRepoPath,
        signal
      });
      return stdout || stderr || 'Comando ejecutado con éxito sin salida por consola.';
    } catch (error: any) {
      if (signal?.aborted || error.name === 'AbortError') {
        throw new Error('Comando cancelado por el usuario.');
      }
      console.error(`[Fathom Assistant] Error CLI:`, error);
      return `Error del sistema al ejecutar el comando:\n${error.message}\nSalida:\n${error.stdout || ''}\n${error.stderr || ''}`;
    }
  }
}
