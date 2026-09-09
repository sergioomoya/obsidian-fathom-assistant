import { GoogleGenAI } from '@google/genai';
import { agentTools } from './tools';
import { ToolExecutor } from './executor';

export class GeminiService {
  private ai: GoogleGenAI;
  
  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('La API Key de Gemini es obligatoria.');
    }
    this.ai = new GoogleGenAI({ apiKey });
  }
  
  /**
   * Envía un mensaje al modelo, que puede contener texto o imágenes.
   * Acepta un historial previo para mantener el contexto.
   */
  async sendMessage(promptParts: any, executor: ToolExecutor, modelName: string = 'gemini-3.7-flash', history: {role: string, text: string}[] = []): Promise<string> {
    try {
      
      let sanitizedHistory: any[] = [];
      for (const msg of history) {
        if (sanitizedHistory.length === 0 && msg.role !== 'user') continue; // Debe empezar por user
        
        const currentRole = msg.role === 'model' ? 'model' : 'user';
        const lastRole = sanitizedHistory.length > 0 ? sanitizedHistory[sanitizedHistory.length - 1].role : null;
        
        if (currentRole === lastRole) {
           // Agrupar mensajes del mismo rol para no romper la estricta alternancia
           sanitizedHistory[sanitizedHistory.length - 1].parts[0].text += "\n\n" + (msg.text || ' ');
        } else {
           sanitizedHistory.push({
             role: currentRole,
             parts: [{ text: msg.text || ' ' }]
           });
        }
      }
      
      // Gemini exige que el último elemento del historial, antes de un nuevo mensaje de usuario, sea siempre de 'model'.
      if (sanitizedHistory.length > 0 && sanitizedHistory[sanitizedHistory.length - 1].role === 'user') {
         sanitizedHistory.push({
            role: 'model',
            parts: [{ text: 'Entendido, continúa.' }]
         });
      }

      const createParams: any = {
        model: modelName,
        config: {
          systemInstruction: 'Eres Fathom Assistant, un asistente virtual experto. Responde siempre en formato markdown.',
          tools: [{ functionDeclarations: agentTools }]
        }
      };

      if (sanitizedHistory.length > 0) {
        createParams.history = sanitizedHistory;
      }

      console.log("FATHOM_DEBUG - SDK createParams.history:", JSON.stringify(createParams.history, null, 2));
      const chat = this.ai.chats.create(createParams);
      
      console.log("FATHOM_DEBUG - SDK payload to sendMessage:", JSON.stringify(promptParts, null, 2));
      
      // Enviar como string puro si es solo un texto para evadir fallos del validador de ContentUnion
      const payload = (promptParts.length === 1 && typeof promptParts[0] === 'string') 
        ? promptParts[0] 
        : promptParts;
        
      // El SDK v2.x exige pasar los parámetros bajo la key `message`
      let response = await chat.sendMessage({ message: payload });
      
      // Manejar llamadas a herramientas (hasta un límite para evitar bucles)
      let maxIterations = 5;
      while (response.functionCalls && response.functionCalls.length > 0 && maxIterations > 0) {
        const functionCall = response.functionCalls[0];
        if (!functionCall.name) break;
        
        console.log(`[Gemini] Llamando a herramienta: ${functionCall.name}`, functionCall.args);
        
        // Ejecutamos la acción localmente
        const toolResult = await executor.execute(functionCall.name, functionCall.args as any);
        console.log(`[Gemini] Resultado de herramienta:`, toolResult);
        
        // Devolvemos el resultado al modelo
        response = await chat.sendMessage({
          message: [{
            functionResponse: {
              name: functionCall.name,
              response: { result: toolResult }
            }
          }] as any
        });
        
        maxIterations--;
      }
      
      return response.text ?? 'Sin respuesta final.';
    } catch (error) {
      console.error('Error llamando a Gemini:', error);
      return `Error interno del Asistente: ${error}`;
    }
  }
}
