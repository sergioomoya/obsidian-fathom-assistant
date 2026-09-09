import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { App } from 'obsidian';

const execAsync = promisify(exec);

/**
 * Encargado de ejecutar físicamente las llamadas a herramientas que el LLM decide invocar.
 */
export class ToolExecutor {
  constructor(private app: App, private fathomRepoPath: string) {}

  /**
   * Ejecuta la herramienta solicitada y devuelve el resultado en texto.
   */
  async execute(name: string, args: Record<string, any>): Promise<string> {
    try {
      switch (name) {
        case 'read_current_note': {
          const file = this.app.workspace.getActiveFile();
          if (!file) return 'No hay ninguna nota abierta actualmente.';
          const content = await this.app.vault.read(file);
          return `Contenido de la nota actual (${file.basename}):\n\n${content}`;
        }
        case 'query_vault': {
          const { query } = args;
          // Búsqueda simplificada: Solo busca en los nombres de archivo para no bloquear el hilo
          const files = this.app.vault.getMarkdownFiles();
          const matches = files.filter(f => f.name.toLowerCase().includes(String(query).toLowerCase()));
          if (matches.length === 0) return `No se encontraron notas que contengan: ${query}`;
          return `Notas encontradas relacionadas con '${query}':\n` + matches.map(m => `- ${m.path}`).join('\n');
        }
        case 'add_domain_mapping': {
          const { domain, company } = args;
          return await this.runCliCommand(`npm run cli add-mapping "${domain}" "${company}"`);
        }
        case 'inject_participants': {
          const { recording_id, participants } = args;
          return await this.runCliCommand(`npm run cli add-override "${recording_id}" "${participants}"`);
        }
        case 'trigger_fathom_sync': {
          return await this.runCliCommand(`npm run cli sync`);
        }
        default:
          return `Error: Herramienta desconocida (${name})`;
      }
    } catch (error: any) {
      return `Excepción ejecutando herramienta ${name}: ${error.message}`;
    }
  }

  /**
   * Envía un comando a la terminal del sistema host, ejecutándolo en el directorio del backend.
   */
  private async runCliCommand(command: string): Promise<string> {
    if (!this.fathomRepoPath) {
      return 'Error fatal: La ruta del repositorio (FATHOM_REPO_PATH) no está configurada en los ajustes del plugin de Obsidian.';
    }
    
    console.log(`[Fathom Assistant] Ejecutando: ${command} en ${this.fathomRepoPath}`);
    try {
      const { stdout, stderr } = await execAsync(command, { cwd: this.fathomRepoPath });
      return stdout || stderr || 'Comando ejecutado con éxito sin salida por consola.';
    } catch (error: any) {
      console.error(`[Fathom Assistant] Error CLI:`, error);
      return `Error del sistema al ejecutar el comando:\n${error.message}\nSalida:\n${error.stdout}\n${error.stderr}`;
    }
  }
}
