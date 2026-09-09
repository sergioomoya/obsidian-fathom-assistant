import { GoogleGenAI } from '@google/genai';
import { agentTools } from './tools';
import { ToolExecutor, ToolExecutionMeta } from './executor';

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
  
  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('La API Key de Gemini es obligatoria.');
    }
    this.ai = new GoogleGenAI({ apiKey });
  }
  
  /**
   * Envía un mensaje al modelo con soporte de streaming en tiempo real y bucle agéntico interactivo.
   */
  async sendMessage(
    promptParts: any, 
    executor: ToolExecutor, 
    modelName: string = 'gemini-3.7-flash', 
    history: {role: string, text: string}[] = [],
    feedback?: AgentUIFeedback,
    signal?: AbortSignal
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

      const createParams: any = {
        model: modelName,
        config: {
          systemInstruction: 'Eres Fathom Assistant, un agente inteligente para Obsidian. Tienes herramientas para consultar notas de la bóveda y ejecutar comandos en Fathom Notebook. Utiliza las herramientas siempre que sea necesario para dar respuestas precisas y actualizadas. Responde en formato markdown limpio y conciso.',
          tools: [{ functionDeclarations: agentTools }]
        }
      };

      if (sanitizedHistory.length > 0) {
        createParams.history = sanitizedHistory;
      }

      const chat = this.ai.chats.create(createParams);
      
      // El SDK v2.x exige pasar los parámetros bajo la key `message`
      const payload = (Array.isArray(promptParts) && promptParts.length === 1 && typeof promptParts[0] === 'string')
        ? promptParts[0]
        : promptParts;
        
      let fullAccumulatedText = '';
      let currentPayload: any = { message: payload };
      let maxIterations = 6;

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

        // Si no hay herramientas que ejecutar, hemos terminado el turno
        if (pendingFunctionCalls.length === 0) {
          break;
        }

        // Ejecutar las herramientas solicitadas emitiendo feedback visual estilo Antigravity
        const functionResponses: any[] = [];
        for (let i = 0; i < pendingFunctionCalls.length; i++) {
          if (signal?.aborted) {
            throw new Error('AbortError');
          }

          const call = pendingFunctionCalls[i];
          const stepId = `step_${Date.now()}_${i}`;
          const initialMeta = executor.getToolMeta(call.name, call.args || {});

          // 1. Notificar inicio de la herramienta a la UI
          if (feedback?.onStepStart) {
            feedback.onStepStart({
              id: stepId,
              group: initialMeta.group,
              displayTitle: initialMeta.displayTitle,
              commandSnippet: initialMeta.commandSnippet,
              status: 'running'
            });
          }

          // 2. Ejecución física de la herramienta
          const execResult = await executor.execute(call.name, call.args || {}, signal);

          // 3. Notificar finalización a la UI
          if (feedback?.onStepUpdate) {
            feedback.onStepUpdate(stepId, {
              status: 'done',
              resultSummary: execResult.meta.resultSummary
            });
          }

          functionResponses.push({
            functionResponse: {
              name: call.name,
              response: { result: execResult.textResult }
            }
          });
        }

        // 4. Devolver las respuestas de las funciones al modelo para la siguiente iteración
        currentPayload = {
          message: functionResponses as any
        };

        maxIterations--;
      }
      
      return fullAccumulatedText || 'Completado con éxito.';
    } catch (error: any) {
      if (signal?.aborted || error.message === 'AbortError' || error.name === 'AbortError') {
        throw new Error('AbortError');
      }
      console.error('Error llamando a Gemini:', error);
      throw error;
    }
  }
}
