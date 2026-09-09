import { GoogleGenAI, FunctionDeclaration } from '@google/genai';
import { agentTools } from './tools';
import { ToolExecutor } from './executor';
import { MCPManager } from './mcp-manager';

export interface AgentActivityStep {
  id: string;
  group: 'files' | 'commands';
  displayTitle: string;
  commandSnippet?: string;
  status: 'running' | 'done' | 'error';
  resultSummary?: string;
}

export interface AgentUIFeedback {
  onStepStart?: (step: AgentActivityStep) => void;
  onStepUpdate?: (stepId: string, update: Partial<AgentActivityStep>) => void;
  onToken?: (token: string) => void;
}

export class GeminiService {
  private ai: GoogleGenAI;
  
  constructor(apiKey: string, private mcpManager?: MCPManager) {
    if (!apiKey) {
      throw new Error('La API Key de Gemini es obligatoria.');
    }
    this.ai = new GoogleGenAI({ apiKey });
  }
  
  /**
   * Envía un mensaje al modelo con streaming en vivo, herramientas locales y soporte para servidores MCP.
   */
  async sendMessage(
    promptParts: any, 
    executor: ToolExecutor, 
    modelName: string = 'gemini-3.7-flash', 
    history: {role: string, text: string}[] = [],
    feedback?: AgentUIFeedback,
    signal?: AbortSignal,
    vaultBaseContext: string = ''
  ): Promise<string> {
    try {
      let sanitizedHistory: any[] = [];
      for (const msg of history) {
        if (sanitizedHistory.length === 0 && msg.role !== 'user') continue;
        
        const currentRole = msg.role === 'model' ? 'model' : 'user';
        const lastRole = sanitizedHistory.length > 0 ? sanitizedHistory[sanitizedHistory.length - 1].role : null;
        
        if (currentRole === lastRole) {
           sanitizedHistory[sanitizedHistory.length - 1].parts[0].text += "\n\n" + (msg.text || ' ');
        } else {
           sanitizedHistory.push({
             role: currentRole,
             parts: [{ text: msg.text || ' ' }]
           });
        }
      }
      
      // Gemini exige que el último elemento del historial previo sea siempre 'model'
      if (sanitizedHistory.length > 0 && sanitizedHistory[sanitizedHistory.length - 1].role === 'user') {
         sanitizedHistory.push({
            role: 'model',
            parts: [{ text: 'Entendido, continúa.' }]
         });
      }

      // 1. Recopilar herramientas locales y herramientas MCP
      const allTools: FunctionDeclaration[] = [...agentTools];
      if (this.mcpManager) {
        const mcpTools = this.mcpManager.getGeminiFunctionDeclarations();
        allTools.push(...mcpTools);
      }

      // 2. Construir System Instructions con jerarquía de contexto y gobernanza
      const systemInstruction = `Eres Fathom Assistant, el agente inteligente de élite integrado en Obsidian.

DIRECTIVAS PRINCIPALES:
1. JERARQUÍA DE CONTEXTO:
   - Foco Prioritario: Si el usuario te proporciona o adjunta notas, documentos o carpetas específicas, tu máxima prioridad y enfoque de análisis debe centrarse en ese material.
   - Autonomía y Acceso Global: El foco en un documento no te limita. Tienes plena libertad y autonomía para invocar herramientas en segundo plano (leer notas con 'query_vault' o 'read_vault_note', leer cualquier archivo en el equipo con 'read_local_file', consultar servidores MCP como NotebookLM o bases de datos SQL) siempre que necesites contrastar información o responder exhaustivamente.
2. GOBERNANZA Y PERMISOS INTERACTIVOS:
   - Antes de ejecutar acciones de impacto significativo (ej: modificar bases de datos SQL, sobreescribir archivos o alterar configuraciones), invoca la herramienta 'request_user_permission' para pedir confirmación en el chat.
   - Para flujos complejos de varios pasos, utiliza 'propose_implementation_plan' para presentar un checklist estructurado.
3. OBLIGACIÓN DE RESPUESTA FINAL COMPLETA:
   - Tras explorar o ejecutar herramientas, DEBES SIEMPRE ofrecer una respuesta final redactada, analítica, estructurada y en profundidad en Markdown que responda directamente a la pregunta o necesidad del usuario.
   - NUNCA des por terminada tu intervención sin redactar el análisis y la respuesta correspondiente.

CONTEXTO BASE DE LA BÓVEDA (CLIENTES Y CONTACTOS):
${vaultBaseContext || 'Directorio de contactos y clientes disponible a través de herramientas.'}`;

      const createParams: any = {
        model: modelName,
        config: {
          systemInstruction,
          tools: [{ functionDeclarations: allTools }]
        }
      };

      if (sanitizedHistory.length > 0) {
        createParams.history = sanitizedHistory;
      }

      const chat = this.ai.chats.create(createParams);
      
      const payload = (Array.isArray(promptParts) && promptParts.length === 1 && typeof promptParts[0] === 'string')
        ? promptParts[0]
        : promptParts;
        
      let fullAccumulatedText = '';
      let currentPayload: any = { message: payload };
      let maxIterations = 25;

      while (maxIterations > 0) {
        if (signal?.aborted) {
          throw new Error('AbortError');
        }

        const streamResponse = await chat.sendMessageStream(currentPayload);
        const pendingFunctionCalls: any[] = [];
        let iterationText = '';

        for await (const chunk of streamResponse) {
          if (signal?.aborted) {
            throw new Error('AbortError');
          }

          // Extraer llamadas a funciones
          if (chunk.functionCalls && chunk.functionCalls.length > 0) {
            for (const fc of chunk.functionCalls) {
              if (fc.name) pendingFunctionCalls.push(fc);
            }
          }

          // Extraer texto y emitir streaming
          const chunkText = chunk.text || '';
          if (chunkText) {
            iterationText += chunkText;
            fullAccumulatedText += chunkText;
            if (feedback?.onToken) {
              feedback.onToken(chunkText);
            }
          }
        }

        // Si no hay herramientas que ejecutar, terminamos el ciclo de herramientas
        if (pendingFunctionCalls.length === 0) {
          break;
        }

        // Ejecutar las herramientas solicitadas (Locales o MCP)
        const functionResponses: any[] = [];
        for (let i = 0; i < pendingFunctionCalls.length; i++) {
          if (signal?.aborted) {
            throw new Error('AbortError');
          }

          const call = pendingFunctionCalls[i];
          const stepId = `step_${Date.now()}_${i}`;
          let textResult = '';
          let resultSummary = 'Completado';

          if (this.mcpManager && this.mcpManager.isMCPTool(call.name)) {
            // --- HERRAMIENTA MCP ---
            const mcpInfo = call.name.split('__');
            const serverName = mcpInfo[1] || 'mcp';
            const toolName = mcpInfo.slice(2).join('__');

            if (feedback?.onStepStart) {
              feedback.onStepStart({
                id: stepId,
                group: 'commands',
                displayTitle: `Ran [${serverName}] ${toolName}`,
                status: 'running'
              });
            }

            try {
              const mcpRes = await this.mcpManager.executeMCPTool(call.name, call.args || {});
              textResult = mcpRes.resultText;
              resultSummary = `${textResult.length} bytes`;
            } catch (err: any) {
              textResult = `Error ejecutando herramienta MCP ${call.name}: ${err.message}`;
              resultSummary = 'Error MCP';
            }

            if (feedback?.onStepUpdate) {
              feedback.onStepUpdate(stepId, {
                status: 'done',
                resultSummary
              });
            }
          } else {
            // --- HERRAMIENTA LOCAL ---
            const initialMeta = executor.getToolMeta(call.name, call.args || {});

            if (feedback?.onStepStart) {
              feedback.onStepStart({
                id: stepId,
                group: initialMeta.group,
                displayTitle: initialMeta.displayTitle,
                commandSnippet: initialMeta.commandSnippet,
                status: 'running'
              });
            }

            const execResult = await executor.execute(call.name, call.args || {}, signal);
            textResult = execResult.textResult;
            resultSummary = execResult.meta.resultSummary || '✓';

            if (feedback?.onStepUpdate) {
              feedback.onStepUpdate(stepId, {
                status: 'done',
                resultSummary
              });
            }
          }

          functionResponses.push({
            functionResponse: {
              name: call.name,
              response: { result: textResult }
            }
          });
        }

        // Devolver las respuestas al modelo para que continúe pensando o responda
        currentPayload = {
          message: functionResponses as any
        };

        maxIterations--;
      }

      // Si tras agotar herramientas aún no ha emitido una respuesta textual al usuario, forzar la síntesis final
      if (!fullAccumulatedText.trim()) {
        const synthesisResponse = await chat.sendMessageStream({
          message: 'Sintetiza ahora y proporciona la respuesta final completa, detallada y estructurada para el usuario basándote en la información recolectada de las herramientas.'
        });
        for await (const chunk of synthesisResponse) {
          if (signal?.aborted) throw new Error('AbortError');
          const chunkText = chunk.text || '';
          if (chunkText) {
            fullAccumulatedText += chunkText;
            if (feedback?.onToken) {
              feedback.onToken(chunkText);
            }
          }
        }
      }
      
      return fullAccumulatedText || 'No se pudo obtener una respuesta detallada del modelo.';
    } catch (error: any) {
      if (signal?.aborted || error.message === 'AbortError' || error.name === 'AbortError') {
        throw new Error('AbortError');
      }
      console.error('Error llamando a Gemini:', error);
      throw error;
    }
  }
}
