import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { App } from 'obsidian';

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

/**
 * Encargado de ejecutar físicamente las llamadas a herramientas que el LLM decide invocar.
 */
export class ToolExecutor {
  constructor(private app: App, private fathomRepoPath: string) {}

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
      case 'query_vault': {
        const query = args.query || '';
        return {
          group: 'files',
          displayTitle: `Search vault for "${query}"`
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
        case 'read_current_note': {
          const file = this.app.workspace.getActiveFile();
          if (!file) {
            meta.resultSummary = 'No hay nota activa';
            return { textResult: 'No hay ninguna nota abierta actualmente.', meta };
          }
          const content = await this.app.vault.read(file);
          meta.resultSummary = `${content.length} caracteres leídos`;
          return { textResult: `Contenido de la nota actual (${file.basename}):\n\n${content}`, meta };
        }
        case 'query_vault': {
          const { query } = args;
          const files = this.app.vault.getMarkdownFiles();
          const matches = files.filter(f => f.path.toLowerCase().includes(String(query).toLowerCase()));
          meta.resultSummary = `${matches.length} nota(s) encontrada(s)`;
          if (matches.length === 0) {
            return { textResult: `No se encontraron notas que contengan: ${query}`, meta };
          }
          return {
            textResult: `Notas encontradas relacionadas con '${query}':\n` + matches.map(m => `- ${m.path}`).join('\n'),
            meta
          };
        }
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
