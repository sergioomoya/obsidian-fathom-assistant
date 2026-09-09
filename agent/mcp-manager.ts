import { spawn, ChildProcess } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { FunctionDeclaration, Type } from '@google/genai';

export interface MCPServerConfig {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  disabled?: boolean;
}

export interface MCPConfigFile {
  mcpServers: Record<string, MCPServerConfig>;
}

interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: any;
}

interface PendingRequest {
  resolve: (result: any) => void;
  reject: (error: any) => void;
  timer?: NodeJS.Timeout;
}

class MCPServerSession {
  private process: ChildProcess | null = null;
  private messageId = 1;
  private pendingRequests = new Map<number, PendingRequest>();
  private buffer = '';
  public tools: MCPTool[] = [];

  constructor(public readonly name: string, private config: MCPServerConfig) {}

  async start(): Promise<void> {
    if (this.process) return;

    const env = { ...process.env, ...(this.config.env || {}) };
    const args = this.config.args || [];
    
    console.log(`[MCP Manager] Iniciando servidor '${this.name}': ${this.config.command} ${args.join(' ')}`);

    try {
      this.process = spawn(this.config.command, args, {
        cwd: this.config.cwd || process.cwd(),
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32'
      });

      this.process.stdout?.on('data', (data: Buffer) => {
        this.handleStdout(data.toString('utf-8'));
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        const str = data.toString('utf-8').trim();
        if (str && !str.includes('ExperimentalWarning')) {
          console.log(`[MCP ${this.name} stderr]:`, str);
        }
      });

      this.process.on('close', (code) => {
        console.log(`[MCP ${this.name}] Proceso cerrado con código ${code}`);
        this.process = null;
      });

      // 1. Inicialización MCP
      await this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'fathom-assistant', version: '1.0.0' }
      });

      // 2. Notificación initialized
      this.sendNotification('notifications/initialized', {});

      // 3. Obtener lista de herramientas
      const toolsResponse = await this.sendRequest('tools/list', {});
      this.tools = toolsResponse?.tools || [];
      console.log(`[MCP ${this.name}] ${this.tools.length} herramientas cargadas con éxito.`);
    } catch (err) {
      console.error(`[MCP ${this.name}] Error iniciando servidor:`, err);
      this.stop();
      throw err;
    }
  }

  private handleStdout(chunk: string) {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
          const req = this.pendingRequests.get(msg.id)!;
          this.pendingRequests.delete(msg.id);
          if (req.timer) clearTimeout(req.timer);

          if (msg.error) {
            req.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          } else {
            req.resolve(msg.result);
          }
        }
      } catch (err) {
        // Ignorar salidas no JSON (logs informativos)
      }
    }
  }

  sendRequest(method: string, params: any, timeoutMs = 45000): Promise<any> {
    if (!this.process || !this.process.stdin) {
      return Promise.reject(new Error(`El servidor MCP '${this.name}' no está iniciado.`));
    }

    const id = this.messageId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Timeout esperando respuesta de MCP '${this.name}' (${method})`));
        }
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });
      this.process!.stdin!.write(payload);
    });
  }

  sendNotification(method: string, params: any) {
    if (!this.process || !this.process.stdin) return;
    const payload = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
    this.process.stdin.write(payload);
  }

  async callTool(toolName: string, args: any): Promise<string> {
    const response = await this.sendRequest('tools/call', {
      name: toolName,
      arguments: args || {}
    });

    if (response?.content && Array.isArray(response.content)) {
      return response.content
        .map((c: any) => c.text || JSON.stringify(c))
        .join('\n');
    }
    return JSON.stringify(response);
  }

  stop() {
    if (this.process) {
      try {
        this.process.kill();
      } catch (e) {}
      this.process = null;
    }
    this.pendingRequests.clear();
  }
}

export class MCPManager {
  private sessions = new Map<string, MCPServerSession>();
  private configPath: string;

  constructor(pluginDir: string) {
    this.configPath = join(pluginDir, 'mcp-config.json');
  }

  /**
   * Carga la configuración local y levanta los servidores activos.
   */
  async initialize(): Promise<void> {
    if (!existsSync(this.configPath)) {
      console.log(`[MCP Manager] No se encontró mcp-config.json en ${this.configPath}`);
      return;
    }

    try {
      const raw = readFileSync(this.configPath, 'utf-8');
      const config: MCPConfigFile = JSON.parse(raw);

      for (const [name, serverCfg] of Object.entries(config.mcpServers || {})) {
        if (serverCfg.disabled) {
          console.log(`[MCP Manager] Servidor '${name}' deshabilitado en configuración.`);
          continue;
        }

        const session = new MCPServerSession(name, serverCfg);
        this.sessions.set(name, session);
        
        // Iniciar en segundo plano sin bloquear el arranque del plugin
        session.start().catch(err => {
          console.warn(`[MCP Manager] No se pudo inicializar servidor '${name}':`, err.message);
        });
      }
    } catch (err) {
      console.error('[MCP Manager] Error leyendo mcp-config.json:', err);
    }
  }

  /**
   * Transforma las herramientas de todos los servidores MCP activos a FunctionDeclarations de Gemini.
   */
  getGeminiFunctionDeclarations(): FunctionDeclaration[] {
    const declarations: FunctionDeclaration[] = [];

    for (const [serverName, session] of this.sessions.entries()) {
      for (const tool of session.tools) {
        const functionName = `mcp__${serverName}__${tool.name}`.replace(/[^a-zA-Z0-9_]/g, '_');
        
        // Mapear inputSchema a formato Gemini
        const properties: Record<string, any> = {};
        const required: string[] = tool.inputSchema?.required || [];

        if (tool.inputSchema?.properties) {
          for (const [propName, propDef] of Object.entries<any>(tool.inputSchema.properties)) {
            properties[propName] = {
              type: this.mapSchemaType(propDef.type),
              description: propDef.description || ''
            };
          }
        }

        declarations.push({
          name: functionName,
          description: `[MCP: ${serverName}] ${tool.description || tool.name}`,
          parameters: {
            type: Type.OBJECT,
            properties,
            required
          }
        });
      }
    }

    return declarations;
  }

  private mapSchemaType(typeStr?: string): Type {
    switch (typeStr) {
      case 'string': return Type.STRING;
      case 'number':
      case 'integer': return Type.NUMBER;
      case 'boolean': return Type.BOOLEAN;
      case 'array': return Type.ARRAY;
      case 'object': return Type.OBJECT;
      default: return Type.STRING;
    }
  }

  /**
   * Comprueba si una llamada de función pertenece a un servidor MCP.
   */
  isMCPTool(functionName: string): boolean {
    return functionName.startsWith('mcp__');
  }

  /**
   * Ejecuta una llamada de herramienta MCP.
   */
  async executeMCPTool(functionName: string, args: any): Promise<{ serverName: string; originalToolName: string; resultText: string }> {
    const parts = functionName.split('__');
    if (parts.length < 3) {
      throw new Error(`Nombre de herramienta MCP inválido: ${functionName}`);
    }

    const serverName = parts[1];
    const toolName = parts.slice(2).join('__');

    const session = this.sessions.get(serverName);
    if (!session) {
      throw new Error(`Servidor MCP '${serverName}' no encontrado o no está activo.`);
    }

    const resultText = await session.callTool(toolName, args);
    return { serverName, originalToolName: toolName, resultText };
  }

  /**
   * Cierra todos los servidores al apagar el plugin.
   */
  closeAll() {
    for (const session of this.sessions.values()) {
      session.stop();
    }
    this.sessions.clear();
  }
}
