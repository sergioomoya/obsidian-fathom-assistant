import { App, Plugin, PluginSettingTab, Setting, ItemView, WorkspaceLeaf, TAbstractFile, TFile, TFolder, MarkdownRenderer, Component } from 'obsidian';
import { GeminiService } from './agent/gemini-service';
import { ToolExecutor } from './agent/executor';

// ─── INTERFACES Y CONSTANTES ────────────────────────────────────────────────────────
interface FathomAssistantSettings {
  geminiApiKey: string;
  fathomRepoPath: string;
  geminiModel: string;
  chatsFolder: string;
}

const DEFAULT_SETTINGS: FathomAssistantSettings = {
  geminiApiKey: '',
  fathomRepoPath: '',
  geminiModel: 'gemini-3.7-flash',
  chatsFolder: 'Fathom Chats'
}

export const VIEW_TYPE_FATHOM_CHAT = "fathom-chat-view";

interface ExtAttachment {
  name: string;
  base64: string;
  mime: string;
}

// ─── VISTA LATERAL (SIDEBAR VIEW) ───────────────────────────────────────────────────
export class FathomChatView extends ItemView {
  private activeContextItems: TAbstractFile[] = [];
  private activeAttachments: ExtAttachment[] = [];
  
  private chatHistory: {role: 'user' | 'model', text: string}[] = [];
  private currentChatFile: TFile | null = null;
  private plugin: FathomAssistantPlugin;

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
    // Cabecera (Header) V4/V5
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
    // Wrapper del input V6 (UI Dinámica)
    const inputWrapper = mainDiv.createDiv({ cls: 'fathom-chat-input-wrapper' });
    this.chipsContainerEl = inputWrapper.createDiv({ cls: 'context-chip-list' });
    
    // Contenedor principal de texto
    const inputContainer = inputWrapper.createDiv({ cls: 'fathom-chat-input-container' });
    
    // --- TEXTAREA ---
    this.inputEl = inputContainer.createEl('textarea', { placeholder: 'Escribe o pega una imagen (Ctrl+V)...' });
    
    // --- BOTON DE ENVIAR (Y STOP) ---
    this.sendBtnEl = inputContainer.createEl('button', { cls: 'fathom-send-btn' });
    this.sendBtnEl.style.display = 'none'; // Vacío por defecto
    
    // --- CHAT FOOTER V7 ---
    const chatFooter = mainDiv.createDiv({ cls: 'fathom-chat-footer' });
    
    // --- POPOVER MENU (anclado al footer) ---
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

    // Cerrar popover clickeando fuera
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
    const models = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3.1-flash', 'gemini-3.1-pro', 'gemini-3.6-flash', 'gemini-3.6-pro'];
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
    
    // --- BOTON DE ENVIAR (Y STOP) ---
    this.sendBtnEl = inputContainer.createEl('button', { cls: 'fathom-send-btn' });
    this.sendBtnEl.style.display = 'none'; // Vacío por defecto
    
    this.inputEl.addEventListener('input', () => this.updateSendBtnState());

    // --- LOGICA DE ENVIO ---
    const submitPrompt = async () => {
      if (this.isGenerating) return;

      const text = this.inputEl.value.trim();
      if (!text && this.activeAttachments.length === 0) return;
      
      this.inputEl.value = '';
      this.inputEl.disabled = true;
      attachBtn.disabled = true;

      this.isGenerating = true;
      this.abortGeneration = false;
      this.updateSendBtnState();

      if (text) {
        this.appendUserMessage(text);
      } else {
        this.appendUserMessage(`[Ha enviado ${this.activeAttachments.length} archivo/s adjunto/s]`);
      }
      
      const loader = this.appendBotMessage('Pensando...');
      
      try {
        const apiKey = this.plugin.settings.geminiApiKey;
        const repoPath = this.plugin.settings.fathomRepoPath;
        const model = this.plugin.settings.geminiModel;

        if (!apiKey) {
          this.updateBotMessage(loader, 'Por favor, configura tu Gemini API Key en los ajustes.');
          return;
        }

        let finalPrompt = text || 'Analiza el/los archivos adjuntos.';
        
        if (this.activeContextItems.length > 0) {
          let contextStr = "CONTEXTO DE OBSIDIAN ADJUNTO:\n\n";
          for (const item of this.activeContextItems) {
            if (item instanceof TFile && item.extension === 'md') {
              const content = await this.app.vault.read(item);
              contextStr += `--- ARCHIVO: ${item.path} ---\n${content}\n--- FIN ARCHIVO ---\n\n`;
            } else if (item instanceof TFolder) {
              const filesInFolder = this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(item.path + '/'));
              for (const f of filesInFolder) {
                const content = await this.app.vault.read(f);
                contextStr += `--- ARCHIVO EN CARPETA (${item.path}): ${f.path} ---\n${content}\n--- FIN ARCHIVO ---\n\n`;
              }
            }
          }
          finalPrompt = `${contextStr}Pregunta/Petición basada en el contexto:\n\n${finalPrompt}`;
        }

        const promptParts: any[] = [];
        promptParts.push(finalPrompt); // Pasar como string puro

        for (const att of this.activeAttachments) {
          promptParts.push({
            inlineData: { data: att.base64, mimeType: att.mime }
          });
        }

        const displayedUserText = text || `[Adjuntos enviados]`;
        this.chatHistory.push({ role: 'user', text: displayedUserText });

        const service = new GeminiService(apiKey);
        const executor = new ToolExecutor(this.app, repoPath);
        
        const abortPromise = new Promise<any>((_, reject) => {
            this.currentAbortResolver = reject;
        });

        // --- LLAMADA A LA API ---
        const response = await Promise.race([
            service.sendMessage(promptParts, executor, model, this.chatHistory.slice(0, -1)),
            abortPromise
        ]);
        
        // --- VERIFICAR ABORTO ---
        if (this.abortGeneration) {
           this.updateBotMessage(loader, '*[Generación detenida por el usuario]*');
           this.chatHistory.pop(); // Removemos la pregunta huérfana para no corromper el historial futuro
           return;
        }
        
        this.updateBotMessage(loader, response);
        this.chatHistory.push({ role: 'model', text: response });
        await this.saveChat();
        
        this.activeContextItems = [];
        this.activeAttachments = [];
        this.renderContextChips();

      } catch (err: any) {
        console.error("FATHOM_DEBUG - RAW ERROR:", err);
        console.error("FATHOM_DEBUG - ERROR STACK:", err.stack);
        if (err.message === 'AbortError' || this.abortGeneration) {
           this.updateBotMessage(loader, '*[Generación detenida por el usuario]*');
           this.chatHistory.pop();
        } else {
           this.updateBotMessage(loader, `Hubo un error: ${err.message}. Abre las DevTools (Ctrl+Shift+I) para ver el log.`);
           this.chatHistory.pop();
        }
      } finally {
        this.isGenerating = false;
        this.updateSendBtnState();
        this.inputEl.disabled = false;
        attachBtn.disabled = false;
        this.inputEl.focus();
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
        if (this.currentAbortResolver) {
            this.currentAbortResolver(new Error('AbortError'));
        }
      } else {
        submitPrompt();
      }
    };

    // Iniciar
    await this.refreshChatList();
    if (!this.currentChatFile) {
      this.startNewChat();
    }
  }

  // --- UI STATE UPDATER ---
  private updateSendBtnState() {
    if (!this.sendBtnEl) return;
    const SVG_ARROW = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>';
    const SVG_STOP = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2" ry="2"></rect></svg>';
    
    if (this.isGenerating) {
      this.sendBtnEl.style.display = 'flex';
      this.sendBtnEl.innerHTML = SVG_STOP;
      this.sendBtnEl.classList.add('stop-mode');
    } else {
      if ((this.inputEl && this.inputEl.value.trim().length > 0) || this.activeAttachments.length > 0) {
        this.sendBtnEl.style.display = 'flex';
        this.sendBtnEl.innerHTML = SVG_ARROW;
        this.sendBtnEl.classList.remove('stop-mode');
      } else {
        this.sendBtnEl.style.display = 'none';
      }
    }
  }

  // ----------------------------------------------------
  // GESTIÓN DE ARCHIVOS DE HISTORIAL
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
    this.chatSelectorEl.empty();
    this.chatSelectorEl.createEl('option', { value: 'new', text: '-- Nuevo Chat --' });
    
    try {
      const folder = await this.getChatsFolder();
      const files = folder.children.filter(f => f instanceof TFile && f.extension === 'md') as TFile[];
      files.sort((a, b) => b.stat.mtime - a.stat.mtime);
      
      for (const f of files) {
        const opt = this.chatSelectorEl.createEl('option', { value: f.path, text: f.basename });
        if (this.currentChatFile && this.currentChatFile.path === f.path) {
          opt.selected = true;
        }
      }
    } catch (e) {
      console.error("Error refreshing chat list", e);
    }
  }

  private startNewChat() {
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
    const regex = /### (Usuario|Fathom)\n\n([\s\S]*?)(?=\n### (Usuario|Fathom)|$)/g;
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
      let counter = 1;
      let path = `${folder.path}/${safeTitle}.md`;
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

  // ----------------------------------------------------
  // MANEJO DE ADJUNTOS
  // ----------------------------------------------------
  private async handleFileAttachment(file: File) {
    return new Promise<void>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        let extName = file.name || 'archivo_pegado';
        if (!file.name && file.type.includes('image')) extName = 'imagen_pegada.png';
        this.activeAttachments.push({ name: extName, base64: base64, mime: file.type || 'application/octet-stream' });
        this.renderContextChips();
        resolve();
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  public addContextItem(item: TAbstractFile) {
    if (!this.activeContextItems.find(f => f.path === item.path)) {
      this.activeContextItems.push(item);
      this.renderContextChips();
      this.updateSendBtnState(); // UI
    }
  }

  private renderContextChips() {
    this.chipsContainerEl.empty();
    for (const item of this.activeContextItems) {
      const chip = this.chipsContainerEl.createDiv({ cls: 'context-chip' });
      const icon = item instanceof TFolder ? '📁' : '📄';
      chip.createSpan({ text: `${icon} ${item.name}` });
      const close = chip.createSpan({ text: '✕', cls: 'context-chip-close' });
      close.onclick = () => {
        this.activeContextItems = this.activeContextItems.filter(f => f.path !== item.path);
        this.renderContextChips();
        this.updateSendBtnState();
      };
    }
    for (const att of this.activeAttachments) {
      const chip = this.chipsContainerEl.createDiv({ cls: 'context-chip' });
      const icon = att.mime.includes('image') ? '🖼️' : '📎';
      chip.createSpan({ text: `${icon} ${att.name}` });
      const close = chip.createSpan({ text: '✕', cls: 'context-chip-close' });
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
    this.renderBotMessageWithCopy(msgDiv, text);
    this.scrollToBottom();
    return msgDiv;
  }

  private updateBotMessage(element: HTMLElement, text: string) {
    element.empty();
    this.renderBotMessageWithCopy(element, text);
    this.scrollToBottom();
  }

  private renderBotMessageWithCopy(element: HTMLElement, text: string) {
    const contentDiv = element.createDiv({ cls: 'chat-message-content' });
    MarkdownRenderer.render(this.app, text, contentDiv, '', new Component());
    
    if (text !== 'Pensando...') {
        const copyBtn = element.createEl('button', { cls: 'fathom-copy-btn', title: 'Copiar Markdown' });
        const SVG_COPY = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
        const SVG_TICK = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        
        copyBtn.innerHTML = SVG_COPY;
        copyBtn.onclick = async () => {
            await navigator.clipboard.writeText(text);
            copyBtn.innerHTML = SVG_TICK;
            setTimeout(() => { if(copyBtn) copyBtn.innerHTML = SVG_COPY; }, 2000);
        };
    }
  }

  private scrollToBottom() {
    setTimeout(() => {
      this.chatBoxEl.scrollTop = this.chatBoxEl.scrollHeight;
    }, 50);
  }
}

// ─── CLASE PRINCIPAL DEL PLUGIN ─────────────────────────────────────────────────────
export default class FathomAssistantPlugin extends Plugin {
  settings: FathomAssistantSettings;

  async onload() {
    console.log('Cargando Fathom Assistant Plugin...');
    await this.loadSettings();

    // Asegurar que la carpeta de chats queda excluida de la bóveda para no molestar
    try {
      let currentFilters = (this.app.vault as any).getConfig("userIgnoreFilters") || [];
      if (!currentFilters.includes(this.settings.chatsFolder)) {
        currentFilters.push(this.settings.chatsFolder);
        (this.app.vault as any).setConfig("userIgnoreFilters", currentFilters);
        console.log(`FATHOM_DEBUG - Carpeta '${this.settings.chatsFolder}' auto-excluida del sistema.`);
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
          this.plugin.settings.geminiApiKey = value;
          await this.plugin.saveSettings();
        }));
        
    new Setting(containerEl)
      .setName('Modelo de Gemini')
      .setDesc('Selecciona el modelo que deseas usar (Flash es rápido, Pro razona mejor).')
      .addDropdown(dropdown => dropdown
        .addOption('gemini-3.7-flash', 'Gemini 3.7 Flash (Recomendado)')
        .addOption('gemini-3.7-pro', 'Gemini 3.7 Pro')
        .addOption('gemini-3.6-flash', 'Gemini 3.6 Flash')
        .addOption('gemini-3.6-pro', 'Gemini 3.6 Pro')
        .addOption('gemini-3.1-flash', 'Gemini 3.1 Flash')
        .addOption('gemini-3.1-pro', 'Gemini 3.1 Pro')
        .addOption('gemini-2.5-flash', 'Gemini 2.5 Flash')
        .addOption('gemini-2.5-pro', 'Gemini 2.5 Pro')
        .setValue(this.plugin.settings.geminiModel || 'gemini-3.7-flash')
        .onChange(async (value) => {
          this.plugin.settings.geminiModel = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Ruta del repositorio Fathom Notebook')
      .setDesc('Ruta absoluta donde se encuentra el proyecto backend')
      .addText(text => text
        .setPlaceholder('C:\\Ruta\\A\\Fathom Notebook')
        .setValue(this.plugin.settings.fathomRepoPath)
        .onChange(async (value) => {
          this.plugin.settings.fathomRepoPath = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Carpeta de Historial de Chats')
      .setDesc('Carpeta de la bóveda donde se guardarán las conversaciones')
      .addText(text => text
        .setPlaceholder('Fathom Chats')
        .setValue(this.plugin.settings.chatsFolder)
        .onChange(async (value) => {
          this.plugin.settings.chatsFolder = value;
          await this.plugin.saveSettings();
        }));
  }
}
