import { App, Plugin, PluginSettingTab, Setting, ItemView, WorkspaceLeaf, TAbstractFile, TFile, TFolder, MarkdownRenderer, Component } from 'obsidian';
import { GeminiService, AgentActivityStep, AgentUIFeedback } from './agent/gemini-service';
import { ToolExecutor, PermissionDecision } from './agent/executor';
import { MCPManager } from './agent/mcp-manager';

// ─── INTERFACES Y CONSTANTES ────────────────────────────────────────────────────────
interface FathomAssistantSettings {
  geminiApiKey: string;
  fathomRepoPath: string;
  geminiModel: string;
  chatsFolder: string;
  alwaysAllowedPermissions: string[];
  autoInjectClientContext: boolean;
}

const DEFAULT_SETTINGS: FathomAssistantSettings = {
  geminiApiKey: '',
  fathomRepoPath: '',
  geminiModel: 'gemini-3.7-flash',
  chatsFolder: 'Fathom Chats',
  alwaysAllowedPermissions: [],
  autoInjectClientContext: true
};

export const VIEW_TYPE_FATHOM_CHAT = "fathom-chat-view";

interface ExtAttachment {
  name: string;
  base64: string;
  mime: string;
}

/**
 * Gestor visual de la actividad agéntica en tiempo real (estilo Antigravity).
 */
class BotActivityTracker {
  private containerEl: HTMLElement;
  private filesGroupEl: HTMLElement | null = null;
  private commandsGroupEl: HTMLElement | null = null;
  private workingIndicatorEl: HTMLElement | null = null;
  
  private filesSteps: AgentActivityStep[] = [];
  private commandSteps: AgentActivityStep[] = [];

  constructor(parentEl: HTMLElement) {
    this.containerEl = parentEl.createDiv({ cls: 'fathom-activity-card' });
  }

  addStep(step: AgentActivityStep) {
    if (step.group === 'files') {
      this.filesSteps.push(step);
      this.renderFilesGroup();
    } else {
      this.commandSteps.push(step);
      this.renderCommandsGroup();
    }
    this.updateWorkingIndicator();
  }

  updateStep(stepId: string, update: Partial<AgentActivityStep>) {
    let found = this.filesSteps.find(s => s.id === stepId);
    if (found) {
      Object.assign(found, update);
      this.renderFilesGroup();
    } else {
      found = this.commandSteps.find(s => s.id === stepId);
      if (found) {
        Object.assign(found, update);
        this.renderCommandsGroup();
      }
    }
    this.updateWorkingIndicator();
  }

  private renderFilesGroup() {
    if (!this.filesGroupEl) {
      this.filesGroupEl = this.containerEl.createDiv({ cls: 'fathom-activity-group' });
    }
    this.filesGroupEl.empty();

    const count = this.filesSteps.length;
    const headerTitle = `Explored ${count} file${count === 1 ? '' : 's'}`;

    const header = this.filesGroupEl.createDiv({ cls: 'fathom-activity-header' });
    header.createSpan({ text: headerTitle });
    const chevron = header.createSpan({ cls: 'fathom-chevron' });
    chevron.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';

    const items = this.filesGroupEl.createDiv({ cls: 'fathom-activity-items' });
    for (const step of this.filesSteps) {
      const itemEl = items.createDiv({ cls: 'fathom-activity-item' });
      itemEl.createSpan({ text: step.displayTitle, cls: 'fathom-item-title' });
      if (step.resultSummary) {
        itemEl.createSpan({ text: step.resultSummary, cls: 'fathom-item-status done' });
      }
    }

    header.onclick = () => {
      this.filesGroupEl?.classList.toggle('is-open');
    };
  }

  private renderCommandsGroup() {
    if (!this.commandsGroupEl) {
      this.commandsGroupEl = this.containerEl.createDiv({ cls: 'fathom-activity-group is-open' });
    }
    this.commandsGroupEl.empty();

    const count = this.commandSteps.length;
    const isRunning = this.commandSteps.some(s => s.status === 'running');
    const headerTitle = isRunning 
      ? `Running ${count} command${count === 1 ? '' : 's'}` 
      : `Ran ${count} command${count === 1 ? '' : 's'}`;

    const header = this.commandsGroupEl.createDiv({ cls: 'fathom-activity-header' });
    header.createSpan({ text: headerTitle });
    const chevron = header.createSpan({ cls: 'fathom-chevron' });
    chevron.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';

    const items = this.commandsGroupEl.createDiv({ cls: 'fathom-activity-items' });
    for (const step of this.commandSteps) {
      const itemEl = items.createDiv({ cls: 'fathom-activity-item' });
      itemEl.createSpan({ text: step.displayTitle, cls: 'fathom-item-title' });
      const statusEl = itemEl.createSpan({ cls: `fathom-item-status ${step.status === 'done' ? 'done' : ''}` });
      statusEl.textContent = step.status === 'done' ? '✓' : (step.resultSummary || '>');
    }

    header.onclick = () => {
      this.commandsGroupEl?.classList.toggle('is-open');
    };
  }

  private updateWorkingIndicator() {
    const hasRunning = this.filesSteps.some(s => s.status === 'running') || this.commandSteps.some(s => s.status === 'running');
    if (hasRunning) {
      if (!this.workingIndicatorEl) {
        this.workingIndicatorEl = this.containerEl.createDiv({ cls: 'fathom-working-indicator', text: 'Working...' });
      }
    } else {
      if (this.workingIndicatorEl) {
        this.workingIndicatorEl.remove();
        this.workingIndicatorEl = null;
      }
    }
  }

  finish() {
    if (this.workingIndicatorEl) {
      this.workingIndicatorEl.remove();
      this.workingIndicatorEl = null;
    }
    if (this.filesSteps.length === 0 && this.commandSteps.length === 0) {
      this.containerEl.remove();
    }
  }
}

// ─── VISTA LATERAL (SIDEBAR VIEW) ───────────────────────────────────────────────────
export class FathomChatView extends ItemView {
  private activeContextItems: TAbstractFile[] = [];
  private activeAttachments: ExtAttachment[] = [];
  
  private chatHistory: {role: 'user' | 'model', text: string}[] = [];
  private currentChatFile: TFile | null = null;
  public plugin: FathomAssistantPlugin;

  // DOM Elements
  private chatBoxEl: HTMLElement;
  private chipsContainerEl: HTMLElement;
  private titleInputEl: HTMLInputElement;
  private chatSelectorEl: HTMLSelectElement;
  private sendBtnEl: HTMLButtonElement;
  private popoverEl: HTMLElement;
  private inputEl: HTMLTextAreaElement;

  // Estados de UI Dinámica
  private isGenerating: boolean = false;
  private abortGeneration: boolean = false;
  private currentAbortResolver: ((reason?: any) => void) | null = null;
  private currentAbortController: AbortController | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: FathomAssistantPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() { return VIEW_TYPE_FATHOM_CHAT; }
  getDisplayText() { return "Fathom Assistant"; }
  getIcon() { return "bot"; }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    
    // Contenedor principal
    const mainDiv = container.createDiv({ cls: 'fathom-chat-container' });
    
    // ----------------------------------------------------
    // Cabecera (Header)
    // ----------------------------------------------------
    const header = mainDiv.createDiv({ cls: 'fathom-chat-header' });
    
    this.titleInputEl = header.createEl('input', { type: 'text', cls: 'chat-title', value: 'Nueva Conversación' });
    this.titleInputEl.onchange = async () => {
      await this.renameCurrentChat(this.titleInputEl.value.trim());
    };

    this.chatSelectorEl = header.createEl('select', { cls: 'chat-selector' });
    this.chatSelectorEl.onchange = async () => {
      const path = this.chatSelectorEl.value;
      if (path === 'new') {
        this.startNewChat();
      } else {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) await this.loadChat(file);
      }
    };

    const newBtn = header.createEl('button', { cls: 'new-chat-btn', text: '+', title: 'Nueva Conversación' });
    newBtn.onclick = () => this.startNewChat();

    const openFolderBtn = header.createEl('button', { cls: 'folder-chat-btn', title: 'Ver Chats' });
    openFolderBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>';
    openFolderBtn.onclick = async () => {
      const folder = await this.getChatsFolder();
      try {
        const fileExplorer = this.app.workspace.getLeavesOfType('file-explorer')[0];
        if (fileExplorer) {
          this.app.workspace.revealLeaf(fileExplorer);
          (fileExplorer.view as any).revealInFolder(folder);
        }
      } catch (e) {
        console.error("FATHOM_DEBUG - No se pudo revelar en explorador de Obsidian", e);
      }
    };

    // ----------------------------------------------------
    // Área de historial de chat
    this.chatBoxEl = mainDiv.createDiv({ cls: 'fathom-chat-box' });

    // ----------------------------------------------------
    // Wrapper del input
    const inputWrapper = mainDiv.createDiv({ cls: 'fathom-chat-input-wrapper' });
    this.chipsContainerEl = inputWrapper.createDiv({ cls: 'context-chip-list' });
    
    // Contenedor principal de texto
    const inputContainer = inputWrapper.createDiv({ cls: 'fathom-chat-input-container' });
    
    // --- TEXTAREA ---
    this.inputEl = inputContainer.createEl('textarea', { placeholder: 'Escribe o pega una imagen (Ctrl+V)...' });
    
    // --- BOTON DE ENVIAR (Y STOP) ---
    this.sendBtnEl = inputContainer.createEl('button', { cls: 'fathom-send-btn' });
    this.sendBtnEl.style.display = 'none';
    
    // --- CHAT FOOTER ---
    const chatFooter = mainDiv.createDiv({ cls: 'fathom-chat-footer' });
    
    // --- POPOVER MENU ---
    this.popoverEl = chatFooter.createDiv({ cls: 'fathom-popover' });
    const popoverList = this.popoverEl.createEl('ul');
    const optionAttach = popoverList.createEl('li', { text: '📎 Adjuntar Archivo' });
    const optionMention = popoverList.createEl('li', { text: '@ Añadir Contexto', cls: 'disabled', title: 'Próximamente' });

    // --- BOTON (+) ---
    const attachBtn = chatFooter.createEl('button', { cls: 'fathom-attach-btn', title: 'Añadir Contexto' });
    attachBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
    
    attachBtn.onclick = (e) => {
      e.stopPropagation();
      this.popoverEl.classList.toggle('visible');
    };

    document.addEventListener('click', (e) => {
      if (this.popoverEl && !this.popoverEl.contains(e.target as Node) && !attachBtn.contains(e.target as Node)) {
        this.popoverEl.classList.remove('visible');
      }
    });

    const fileInput = chatFooter.createEl('input', { type: 'file', cls: 'fathom-file-input' });
    fileInput.multiple = true;
    optionAttach.onclick = () => { fileInput.click(); this.popoverEl.classList.remove('visible'); };
    
    fileInput.onchange = async (e: any) => {
      for (const file of e.target.files) {
        await this.handleFileAttachment(file);
      }
      fileInput.value = '';
      this.updateSendBtnState(); 
    };

    // --- SELECTOR DE MODELO EN FOOTER ---
    const modelSelect = chatFooter.createEl('select', { cls: 'fathom-model-selector' });
    const models = [
      'gemini-3.7-flash', 
      'gemini-2.5-flash', 
      'gemini-2.5-pro', 
      'gemini-3.1-flash', 
      'gemini-3.1-pro'
    ];
    for (const m of models) {
      modelSelect.createEl('option', { value: m, text: m });
    }
    modelSelect.value = this.plugin.settings.geminiModel;
    modelSelect.onchange = async () => {
      this.plugin.settings.geminiModel = modelSelect.value;
      await this.plugin.saveSettings();
    };

    // Lógica Input Events
    this.inputEl.addEventListener('paste', async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1 || items[i].kind === 'file') {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            await this.handleFileAttachment(file);
            this.updateSendBtnState();
          }
        }
      }
    });
    
    this.inputEl.addEventListener('input', () => this.updateSendBtnState());

    // --- LOGICA DE ENVIO CON GOBERNANZA INTERACTIVA Y STREAMING ---
    const submitPrompt = async () => {
      if (this.isGenerating) return;

      const text = this.inputEl.value.trim();
      if (!text && this.activeAttachments.length === 0) return;
      
      this.inputEl.value = '';
      this.inputEl.disabled = true;
      attachBtn.disabled = true;

      this.isGenerating = true;
      this.abortGeneration = false;
      this.currentAbortController = new AbortController();
      this.updateSendBtnState();

      if (text) {
        this.appendUserMessage(text);
      } else {
        this.appendUserMessage(`[Ha enviado ${this.activeAttachments.length} archivo/s adjunto/s]`);
      }
      
      // Contenedores del mensaje del bot
      const botMsgDiv = this.chatBoxEl.createDiv({ cls: 'chat-message chat-message-bot' });
      const activityTracker = new BotActivityTracker(botMsgDiv);
      const interactiveCardsEl = botMsgDiv.createDiv({ cls: 'fathom-interactive-cards' });
      const contentDiv = botMsgDiv.createDiv({ cls: 'chat-message-content' });
      this.scrollToBottom();

      let accumulatedResponseText = '';
      
      try {
        const apiKey = this.plugin.settings.geminiApiKey;
        const repoPath = this.plugin.settings.fathomRepoPath;
        const model = this.plugin.settings.geminiModel;

        if (!apiKey) {
          activityTracker.finish();
          MarkdownRenderer.render(this.app, 'Por favor, configura tu Gemini API Key en los ajustes del plugin.', contentDiv, '', new Component());
          return;
        }

        let finalPrompt = text || 'Analiza el/los archivos adjuntos.';
        
        // 1. Contexto manual adjunto (Foco prioritario)
        if (this.activeContextItems.length > 0) {
          let contextStr = "=== CONTEXTO MANUAL ADJUNTO POR EL USUARIO (FOCO PRIORITARIO) ===\n\n";
          for (const item of this.activeContextItems) {
            if (item instanceof TFile && item.extension === 'md') {
              const content = await this.app.vault.read(item);
              contextStr += `--- NOTA ADJUNTA: ${item.path} ---\n${content}\n--- FIN NOTA ---\n\n`;
            } else if (item instanceof TFolder) {
              const filesInFolder = this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(item.path + '/'));
              for (const f of filesInFolder) {
                const content = await this.app.vault.read(f);
                contextStr += `--- NOTA EN CARPETA ADJUNTA (${item.path}): ${f.path} ---\n${content}\n--- FIN NOTA ---\n\n`;
              }
            }
          }
          finalPrompt = `${contextStr}=== FIN CONTEXTO ADJUNTO ===\n\nPetición del usuario:\n${finalPrompt}`;
        }

        const promptParts: any[] = [];
        promptParts.push(finalPrompt);

        for (const att of this.activeAttachments) {
          promptParts.push({
            inlineData: { data: att.base64, mimeType: att.mime }
          });
        }

        const displayedUserText = text || `[Adjuntos enviados]`;
        this.chatHistory.push({ role: 'user', text: displayedUserText });

        // 2. Contexto base de la bóveda (Directorio de contactos y clientes)
        const vaultBaseContext = await this.getVaultBaseContext();

        // 3. Configurar Handlers interactivos de permisos y planes
        const executor = new ToolExecutor(this.app, repoPath, {
          alwaysAllowedPermissions: this.plugin.settings.alwaysAllowedPermissions || [],
          onAlwaysAllow: async (key: string) => {
            if (!this.plugin.settings.alwaysAllowedPermissions) {
              this.plugin.settings.alwaysAllowedPermissions = [];
            }
            if (!this.plugin.settings.alwaysAllowedPermissions.includes(key)) {
              this.plugin.settings.alwaysAllowedPermissions.push(key);
              await this.plugin.saveSettings();
            }
          },
          onRequestPermission: (permTitle, permDetails, dangerLevel, permKey) => {
            return new Promise<PermissionDecision>((resolve) => {
              const card = interactiveCardsEl.createDiv({ cls: 'fathom-permission-card' });
              
              const pHeader = card.createDiv({ cls: 'fathom-permission-header' });
              pHeader.innerHTML = `⚠️ <span>Permiso Requerido: ${permTitle}</span>`;

              const pDetails = card.createDiv({ cls: 'fathom-permission-details', text: permDetails });

              const actions = card.createDiv({ cls: 'fathom-permission-actions' });
              
              const btnApprove = actions.createEl('button', { cls: 'btn-perm-approve', text: 'Aprobar una vez' });
              const btnAlways = actions.createEl('button', { cls: 'btn-perm-always', text: '🔒 Aprobar siempre' });
              const btnReject = actions.createEl('button', { cls: 'btn-perm-reject', text: 'Rechazar' });

              const finalize = (choice: string) => {
                btnApprove.disabled = true;
                btnAlways.disabled = true;
                btnReject.disabled = true;
                actions.empty();
                actions.createSpan({ cls: 'fathom-item-status done', text: `Elección: ${choice}` });
                this.scrollToBottom();
              };

              btnApprove.onclick = () => {
                finalize('Aprobado una vez');
                resolve('approved');
              };

              btnAlways.onclick = () => {
                finalize('Aprobado siempre (guardado en memoria)');
                resolve('always');
              };

              btnReject.onclick = () => {
                finalize('Rechazado');
                resolve('rejected');
              };

              this.scrollToBottom();
            });
          },
          onProposePlan: (planTitle, planSummary, planSteps) => {
            return new Promise<'approved' | 'rejected'>((resolve) => {
              const card = interactiveCardsEl.createDiv({ cls: 'fathom-plan-card' });
              
              const pTitle = card.createDiv({ cls: 'fathom-plan-title' });
              pTitle.innerHTML = `📋 <span>Plan de Acción: ${planTitle}</span>`;

              if (planSummary) {
                card.createDiv({ cls: 'fathom-plan-summary', text: planSummary });
              }

              const stepsList = card.createDiv({ cls: 'fathom-plan-steps' });
              planSteps.forEach((step, idx) => {
                const stepEl = stepsList.createDiv({ cls: 'fathom-plan-step' });
                stepEl.createSpan({ cls: 'fathom-plan-step-num', text: `${idx + 1}.` });
                stepEl.createSpan({ text: step });
              });

              const actions = card.createDiv({ cls: 'fathom-plan-actions' });
              const btnProceed = actions.createEl('button', { cls: 'btn-plan-proceed', text: '🚀 Proceder con el Plan' });

              btnProceed.onclick = () => {
                btnProceed.disabled = true;
                btnProceed.textContent = '✓ Plan Aprobado';
                resolve('approved');
              };

              this.scrollToBottom();
            });
          }
        });

        const service = new GeminiService(apiKey, this.plugin.mcpManager);
        
        const abortPromise = new Promise<any>((_, reject) => {
          this.currentAbortResolver = reject;
        });

        const feedback: AgentUIFeedback = {
          onStepStart: (step) => {
            activityTracker.addStep(step);
            this.scrollToBottom();
          },
          onStepUpdate: (stepId, update) => {
            activityTracker.updateStep(stepId, update);
            this.scrollToBottom();
          },
          onToken: (token) => {
            accumulatedResponseText += token;
            contentDiv.empty();
            MarkdownRenderer.render(this.app, accumulatedResponseText, contentDiv, '', new Component());
            this.scrollToBottom();
          }
        };

        // --- LLAMADA AGÉNTICA CON GOBERNANZA Y STREAMING ---
        const response = await Promise.race([
          service.sendMessage(
            promptParts, 
            executor, 
            model, 
            this.chatHistory.slice(0, -1), 
            feedback, 
            this.currentAbortController.signal,
            vaultBaseContext
          ),
          abortPromise
        ]);
        
        activityTracker.finish();

        if (this.abortGeneration) {
           contentDiv.empty();
           MarkdownRenderer.render(this.app, '*[Generación detenida por el usuario]*', contentDiv, '', new Component());
           this.chatHistory.pop();
           return;
        }
        
        contentDiv.empty();
        MarkdownRenderer.render(this.app, response, contentDiv, '', new Component());
        this.injectCopyButton(botMsgDiv, response);

        this.chatHistory.push({ role: 'model', text: response });
        await this.saveChat();
        
        this.activeContextItems = [];
        this.activeAttachments = [];
        this.renderContextChips();

      } catch (err: any) {
        activityTracker.finish();
        console.error("FATHOM_DEBUG - RAW ERROR:", err);
        if (err.message === 'AbortError' || this.abortGeneration) {
           contentDiv.empty();
           MarkdownRenderer.render(this.app, '*[Generación detenida por el usuario]*', contentDiv, '', new Component());
           this.chatHistory.pop();
        } else {
           contentDiv.empty();
           MarkdownRenderer.render(this.app, `Hubo un error: ${err.message}. Abre las DevTools (Ctrl+Shift+I) para ver el log.`, contentDiv, '', new Component());
           this.chatHistory.pop();
        }
      } finally {
        this.isGenerating = false;
        this.currentAbortController = null;
        this.updateSendBtnState();
        this.inputEl.disabled = false;
        attachBtn.disabled = false;
        this.inputEl.focus();
        this.scrollToBottom();
      }
    };

    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitPrompt();
      }
    });

    this.sendBtnEl.onclick = () => {
      if (this.isGenerating) {
        this.abortGeneration = true;
        if (this.currentAbortController) {
          this.currentAbortController.abort();
        }
        if (this.currentAbortResolver) {
          this.currentAbortResolver(new Error('AbortError'));
        }
      } else {
        submitPrompt();
      }
    };

    await this.refreshChatList();
    if (!this.currentChatFile) {
      this.startNewChat();
    }
  }

  // --- CARGA DE CONTEXTO BASE DE CLIENTES Y CONTACTOS ---
  private async getVaultBaseContext(): Promise<string> {
    if (!this.plugin.settings.autoInjectClientContext) {
      return '';
    }

    let baseStr = '';
    
    // 1. Directorio maestro de contactos
    const contactsFile = this.app.vault.getAbstractFileByPath('contacts.md');
    if (contactsFile instanceof TFile) {
      try {
        const content = await this.app.vault.read(contactsFile);
        baseStr += `--- DIRECTORIO GENERAL DE CONTACTOS (contacts.md) ---\n${content}\n\n`;
      } catch (e) {}
    }

    // 2. Lista de carpetas de clientes en la raíz
    const rootFolders = this.app.vault.getRoot().children.filter(f => f instanceof TFolder && !f.name.startsWith('.') && f.name !== 'Fathom Chats');
    if (rootFolders.length > 0) {
      baseStr += `--- CARPETAS DE CLIENTES EN LA BÓVEDA ---\n${rootFolders.map(f => `- ${f.name}`).join('\n')}\n\n`;
    }

    return baseStr;
  }

  // --- UI STATE UPDATER ---
  private updateSendBtnState() {
    if (!this.sendBtnEl) return;
    const SVG_ARROW = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>';
    const SVG_STOP = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2" ry="2"></rect></svg>';
    
    if (this.isGenerating) {
      this.sendBtnEl.style.display = 'flex';
      this.sendBtnEl.classList.add('stop-mode');
      this.sendBtnEl.innerHTML = SVG_STOP;
      this.sendBtnEl.title = 'Parar generación';
    } else {
      this.sendBtnEl.classList.remove('stop-mode');
      const hasText = this.inputEl && this.inputEl.value.trim().length > 0;
      const hasAttachments = this.activeAttachments.length > 0;
      
      if (hasText || hasAttachments) {
        this.sendBtnEl.style.display = 'flex';
        this.sendBtnEl.innerHTML = SVG_ARROW;
        this.sendBtnEl.title = 'Enviar mensaje';
      } else {
        this.sendBtnEl.style.display = 'none';
      }
    }
  }

  // ----------------------------------------------------
  // GESTIÓN DE HISTORIAL
  // ----------------------------------------------------
  private async getChatsFolder(): Promise<TFolder> {
    const folderPath = this.plugin.settings.chatsFolder;
    let folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!folder) {
      folder = await this.app.vault.createFolder(folderPath);
    }
    return folder as TFolder;
  }

  private async refreshChatList() {
    if (!this.chatSelectorEl) return;
    
    try {
      const folder = await this.getChatsFolder();
      const files = folder.children.filter(f => f instanceof TFile && f.extension === 'md') as TFile[];
      files.sort((a, b) => b.stat.mtime - a.stat.mtime);
      
      this.chatSelectorEl.empty();
      this.chatSelectorEl.createEl('option', { value: 'new', text: '-- Nuevo Chat --' });
      
      for (const f of files) {
        const opt = this.chatSelectorEl.createEl('option', { value: f.path, text: f.basename });
        if (this.currentChatFile && this.currentChatFile.path === f.path) {
          opt.selected = true;
        }
      }
    } catch (e) {
      console.error("FATHOM_DEBUG - Error refrescando lista de chats:", e);
    }
  }

  public startNewChat() {
    this.currentChatFile = null;
    this.chatHistory = [];
    if(this.titleInputEl) this.titleInputEl.value = 'Nueva Conversación';
    if(this.chatBoxEl) {
      this.chatBoxEl.empty();
      this.appendBotMessage('Hola, soy **Fathom Assistant**. Haz clic derecho en notas/carpetas o usa el botón + para adjuntar archivos.');
    }
    if(this.chatSelectorEl) this.chatSelectorEl.value = 'new';
  }

  private async loadChat(file: TFile) {
    this.currentChatFile = file;
    this.titleInputEl.value = file.basename;
    this.chatBoxEl.empty();
    this.chatHistory = [];
    
    const content = await this.app.vault.read(file);
    const regex = /### (Usuario|Fathom)\n\n([\s\S]*?)(?=\n\n###|$)/g;
    let match;
    
    while ((match = regex.exec(content)) !== null) {
      const role = match[1] === 'Usuario' ? 'user' : 'model';
      const text = match[2].trim();
      this.chatHistory.push({ role, text });
      if (role === 'user') this.appendUserMessage(text);
      else this.appendBotMessage(text);
    }
    
    await this.refreshChatList();
  }

  private async saveChat() {
    let content = "";
    for (const msg of this.chatHistory) {
      const header = msg.role === 'user' ? '### Usuario' : '### Fathom';
      content += `${header}\n\n${msg.text}\n\n`;
    }

    if (!this.currentChatFile) {
      const folder = await this.getChatsFolder();
      let title = this.titleInputEl.value || 'Nueva Conversación';
      if (title === 'Nueva Conversación') {
        const firstMsg = this.chatHistory[0]?.text;
        if (firstMsg && !firstMsg.includes('[Adjuntos')) {
          title = firstMsg.substring(0, 30).replace(/[^a-zA-Z0-9 ]/g, "").trim();
        }
      }
      this.titleInputEl.value = title;
      
      let safeTitle = title;
      let path = `${folder.path}/${safeTitle}.md`;
      let counter = 1;
      while (this.app.vault.getAbstractFileByPath(path)) {
        safeTitle = `${title} (${counter})`;
        path = `${folder.path}/${safeTitle}.md`;
        counter++;
      }
      
      this.currentChatFile = await this.app.vault.create(path, content);
      await this.refreshChatList();
    } else {
      await this.app.vault.modify(this.currentChatFile, content);
    }
  }

  private async renameCurrentChat(newTitle: string) {
    if (!this.currentChatFile || !newTitle) return;
    const folder = await this.getChatsFolder();
    const newPath = `${folder.path}/${newTitle}.md`;
    if (!this.app.vault.getAbstractFileByPath(newPath)) {
      await this.app.vault.rename(this.currentChatFile, newPath);
      await this.refreshChatList();
    } else {
      this.titleInputEl.value = this.currentChatFile.basename;
    }
  }

  public addContextItem(file: TAbstractFile) {
    if (!this.activeContextItems.some(item => item.path === file.path)) {
      this.activeContextItems.push(file);
      this.renderContextChips();
      this.updateSendBtnState();
    }
  }

  public async handleFileAttachment(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      this.activeAttachments.push({
        name: file.name,
        base64,
        mime: file.type || 'application/octet-stream'
      });
      this.renderContextChips();
      this.updateSendBtnState();
    };
    reader.readAsDataURL(file);
  }

  private renderContextChips() {
    this.chipsContainerEl.empty();

    for (const item of this.activeContextItems) {
      const chip = this.chipsContainerEl.createDiv({ cls: 'context-chip' });
      const isFolder = item instanceof TFolder;
      chip.createSpan({ text: `${isFolder ? '📁' : '📄'} ${item.name}` });
      
      const close = chip.createSpan({ cls: 'context-chip-close', text: '×' });
      close.onclick = () => {
        this.activeContextItems = this.activeContextItems.filter(i => i.path !== item.path);
        this.renderContextChips();
        this.updateSendBtnState();
      };
    }

    for (const att of this.activeAttachments) {
      const chip = this.chipsContainerEl.createDiv({ cls: 'context-chip' });
      chip.createSpan({ text: `📎 ${att.name}` });
      
      const close = chip.createSpan({ cls: 'context-chip-close', text: '×' });
      close.onclick = () => {
        this.activeAttachments = this.activeAttachments.filter(a => a !== att);
        this.renderContextChips();
        this.updateSendBtnState();
      };
    }
  }

  private appendUserMessage(text: string) {
    const msgDiv = this.chatBoxEl.createDiv({ cls: 'chat-message chat-message-user' });
    msgDiv.createEl('p', { text });
    this.scrollToBottom();
  }

  private appendBotMessage(text: string): HTMLElement {
    const msgDiv = this.chatBoxEl.createDiv({ cls: 'chat-message chat-message-bot' });
    const contentDiv = msgDiv.createDiv({ cls: 'chat-message-content' });
    MarkdownRenderer.render(this.app, text, contentDiv, '', new Component());
    if (text && !text.startsWith('Pensando...')) {
      this.injectCopyButton(msgDiv, text);
    }
    this.scrollToBottom();
    return msgDiv;
  }

  private injectCopyButton(container: HTMLElement, rawMarkdown: string) {
    const copyBtn = container.createEl('button', { cls: 'fathom-copy-btn', title: 'Copiar Markdown' });
    const SVG_COPY = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
    const SVG_TICK = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    
    copyBtn.innerHTML = SVG_COPY;
    copyBtn.onclick = async () => {
      await navigator.clipboard.writeText(rawMarkdown);
      copyBtn.innerHTML = SVG_TICK;
      setTimeout(() => { if(copyBtn) copyBtn.innerHTML = SVG_COPY; }, 2000);
    };
  }

  private scrollToBottom() {
    setTimeout(() => {
      this.chatBoxEl.scrollTop = this.chatBoxEl.scrollHeight;
    }, 30);
  }
}

// ─── CLASE PRINCIPAL DEL PLUGIN ─────────────────────────────────────────────────────
export default class FathomAssistantPlugin extends Plugin {
  settings: FathomAssistantSettings;
  mcpManager: MCPManager;

  async onload() {
    console.log('Cargando Fathom Assistant Plugin...');
    await this.loadSettings();

    // 1. Inicializar cliente MCP independiente
    const pluginDir = (this.app.vault.adapter as any).basePath 
      ? `${(this.app.vault.adapter as any).basePath}/.obsidian/plugins/fathom-assistant`
      : '.';
    
    this.mcpManager = new MCPManager(pluginDir);
    this.mcpManager.initialize().catch(err => console.warn("FATHOM_DEBUG - MCP Manager init:", err));

    // 2. Auto-excluir la carpeta de chats de la bóveda
    try {
      let currentFilters = (this.app.vault as any).getConfig("userIgnoreFilters") || [];
      if (!currentFilters.includes(this.settings.chatsFolder)) {
        currentFilters.push(this.settings.chatsFolder);
        (this.app.vault as any).setConfig("userIgnoreFilters", currentFilters);
      }
    } catch (e) {
      console.warn("FATHOM_DEBUG - No se pudo excluir la carpeta automáticamente", e);
    }

    this.registerView(
      VIEW_TYPE_FATHOM_CHAT,
      (leaf) => new FathomChatView(leaf, this)
    );

    this.addRibbonIcon('bot', 'Abrir Fathom Assistant', () => {
      this.activateView();
    });

    this.addSettingTab(new FathomAssistantSettingTab(this.app, this));

    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file: TAbstractFile) => {
        if ((file instanceof TFile && file.extension === 'md') || file instanceof TFolder) {
          menu.addItem((item) => {
            item
              .setTitle('Añadir contexto a Fathom Assistant')
              .setIcon('bot')
              .onClick(() => {
                const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_FATHOM_CHAT);
                if (leaves.length > 0) {
                  const view = leaves[0].view as FathomChatView;
                  view.addContextItem(file);
                  this.app.workspace.revealLeaf(leaves[0]);
                } else {
                  this.activateView().then(() => {
                    const lvs = this.app.workspace.getLeavesOfType(VIEW_TYPE_FATHOM_CHAT);
                    if (lvs.length > 0) {
                      (lvs[0].view as FathomChatView).addContextItem(file);
                    }
                  });
                }
              });
          });
        }
      })
    );
  }

  async onunload() {
    if (this.mcpManager) {
      this.mcpManager.closeAll();
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_FATHOM_CHAT)[0];
    
    if (!leaf) {
      leaf = workspace.getRightLeaf(false)!;
      await leaf.setViewState({ type: VIEW_TYPE_FATHOM_CHAT, active: true });
    }
    if (leaf) workspace.revealLeaf(leaf);
  }
}

// ─── PESTAÑA DE CONFIGURACIÓN ───────────────────────────────────────────────────────
class FathomAssistantSettingTab extends PluginSettingTab {
  plugin: FathomAssistantPlugin;

  constructor(app: App, plugin: FathomAssistantPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Configuración de Fathom Assistant' });

    new Setting(containerEl)
      .setName('Gemini API Key')
      .setDesc('Clave de la API de Google Gemini')
      .addText(text => text
        .setPlaceholder('AIzaSy...')
        .setValue(this.plugin.settings.geminiApiKey)
        .onChange(async (value) => {
          this.plugin.settings.geminiApiKey = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Modelo de Gemini por defecto')
      .setDesc('Modelo a utilizar por el asistente')
      .addDropdown(drop => drop
        .addOption('gemini-3.7-flash', 'Gemini 3.7 Flash')
        .addOption('gemini-2.5-flash', 'Gemini 2.5 Flash')
        .addOption('gemini-2.5-pro', 'Gemini 2.5 Pro')
        .addOption('gemini-3.1-flash', 'Gemini 3.1 Flash')
        .addOption('gemini-3.1-pro', 'Gemini 3.1 Pro')
        .setValue(this.plugin.settings.geminiModel)
        .onChange(async (value) => {
          this.plugin.settings.geminiModel = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Ruta del repositorio Fathom Notebook')
      .setDesc('Ruta absoluta donde se encuentra el proyecto backend')
      .addText(text => text
        .setPlaceholder('C:\\Ruta\\A\\Fathom Notebook')
        .setValue(this.plugin.settings.fathomRepoPath)
        .onChange(async (value) => {
          this.plugin.settings.fathomRepoPath = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Carpeta de Chats')
      .setDesc('Nombre de la carpeta de la bóveda donde se guardan los historiales')
      .addText(text => text
        .setPlaceholder('Fathom Chats')
        .setValue(this.plugin.settings.chatsFolder)
        .onChange(async (value) => {
          this.plugin.settings.chatsFolder = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Contexto de Clientes y Contactos por defecto')
      .setDesc('Inyectar automáticamente el directorio contacts.md y la lista de clientes en las instrucciones base.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoInjectClientContext ?? true)
        .onChange(async (value) => {
          this.plugin.settings.autoInjectClientContext = value;
          await this.plugin.saveSettings();
        }));

    // ─── SECCIÓN: GOBERNANZA Y PERMISOS AUTORIZADOS ───
    containerEl.createEl('h3', { text: '🔒 Gobernanza y Memoria de Permisos' });
    const allowed = this.plugin.settings.alwaysAllowedPermissions || [];
    
    if (allowed.length === 0) {
      containerEl.createEl('p', { 
        text: 'No tienes permisos concedidos permanentemente. El asistente solicitará tu aprobación interactiva en el chat cuando intente acciones de impacto.',
        cls: 'setting-item-description'
      });
    } else {
      containerEl.createEl('p', {
        text: `Tienes ${allowed.length} acción(es) autorizadas permanentemente:`,
        cls: 'setting-item-description'
      });

      for (const permKey of allowed) {
        new Setting(containerEl)
          .setName(permKey.replace(/^perm_/, '').replace(/_/g, ' '))
          .addButton(btn => btn
            .setButtonText('Revocar Permiso')
            .setWarning()
            .onClick(async () => {
              this.plugin.settings.alwaysAllowedPermissions = this.plugin.settings.alwaysAllowedPermissions.filter(k => k !== permKey);
              await this.plugin.saveSettings();
              this.display();
            }));
      }

      new Setting(containerEl)
        .setName('Restablecer todos los permisos')
        .setDesc('Elimina todas las autorizaciones permanentes guardadas.')
        .addButton(btn => btn
          .setButtonText('Olvidar Todos')
          .onClick(async () => {
            this.plugin.settings.alwaysAllowedPermissions = [];
            await this.plugin.saveSettings();
            this.display();
          }));
    }

    // ─── SECCIÓN: SERVIDORES MCP ───
    containerEl.createEl('h3', { text: '🔌 Servidores MCP (Model Context Protocol)' });
    containerEl.createEl('p', {
      text: 'Los servidores MCP se gestionan de forma independiente en el archivo mcp-config.json del plugin (soporta notebooklm, sqlserver, etc.).',
      cls: 'setting-item-description'
    });
  }
}
