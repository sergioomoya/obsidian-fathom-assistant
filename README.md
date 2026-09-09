# 🤖 Fathom Assistant para Obsidian

**Fathom Assistant** es un plugin para [Obsidian](https://obsidian.md/) que integra un Agente de Inteligencia Artificial de alto rendimiento basado en **Google Gemini** directamente en el panel lateral de tu bóveda. 

Diseñado bajo la directiva del *Manifiesto del Artesano de Software*, Fathom Assistant prioriza una interfaz hiper-minimalista, fluida y sin fricción (inspirada en la experiencia de Antigravity), combinada con razonamiento avanzado, conciencia total del contexto de tus notas y ejecución autónoma de herramientas sobre la bóveda y el backend de **Fathom Notebook**.

---

## 🌟 Características Principales

* **UI Dinámica en Dos Capas:** Caja de entrada expansible superior y un pie de chat sutil inferior con selector de modelos y botón de adjuntos.
* **Selector Dinámico de Modelos:** Alterna al vuelo entre `Gemini 3.7 Flash`, `Gemini 3.6 Flash / Pro`, `Gemini 3.1 Flash / Pro` y `Gemini 2.5 Flash / Pro`.
* **Conciencia del Contexto (Context-Aware):** Haz clic derecho en cualquier archivo o carpeta en el explorador de Obsidian y selecciona *"Añadir contexto a Fathom Assistant"*. El modelo analizará los documentos seleccionados representados mediante etiquetas visuales (chips).
* **Gestión de Historial Auto-Excluida:** Las conversaciones se guardan en Markdown en la carpeta designada (`Fathom Chats`). El plugin **auto-excluye** esta carpeta mediante `userIgnoreFilters` para que no contamine la búsqueda global ni el grafo de notas.
* **Cancelación Instantánea (`AbortController`):** Botón de parada de emergencia (cuadrado rojo) que cancela inmediatamente la petición de red y el streaming de tokens.
* **Copiado Fiel de Markdown:** Botón flotante al hacer hover sobre cualquier mensaje para copiar la respuesta en Markdown íntegro (tablas, listas y código).
* **Soporte Multimodal:** Pega imágenes con `Ctrl + V`, arrástralas al panel o súbelas mediante el botón de adjuntos.
* **Tool Executor Integrado:** El agente puede leer la nota activa (`read_current_note`), buscar notas en la bóveda (`query_vault`), registrar mapeos de clientes (`add_domain_mapping`), forzar asistentes (`inject_participants`) y sincronizar reuniones (`trigger_fathom_sync`).

---

## 📚 Documentación Técnica y Guías

Consulta la documentación detallada en la carpeta [`docs/`](docs/):

* 🏛️ **[Arquitectura del Sistema](docs/arquitectura.md):** Integración con `@google/genai` v2.x, sanitización de historial, normalización de payloads, auto-exclusión en Obsidian y ciclo de vida.
* 📖 **[Guía de Usuario](docs/guia_usuario.md):** Manual paso a paso: configuración de API Keys, selección de modelos, atajos de contexto, gestión de conversaciones y comandos del agente.
* ⚖️ **[Registro de Decisiones (ADR)](docs/decisiones.md):** Justificación de decisiones arquitectónicas clave.
* 🛠️ **[Catálogo de Herramientas del Agente](docs/herramientas_agente.md):** Especificación técnica de cada función ejecutable por el modelo (`FunctionDeclaration`).

---

## ⚙️ Requisitos

1. **Obsidian** (versión de escritorio v1.4+ recomendada).
2. **Node.js** (v18 o superior) y **NPM** (para compilar desde el código fuente).
3. **Google Gemini API Key:** Clave de API de [Google AI Studio](https://aistudio.google.com/).

---

## 🚀 Instalación y Compilación

```bash
# 1. Navega hasta la carpeta del plugin en tu bóveda de Obsidian
cd .obsidian/plugins/fathom-assistant

# 2. Instala dependencias
npm install

# 3. Compila el código para producción
npm run build
```

Abre Obsidian, ve a **Ajustes > Opciones de la comunidad > Plugins instalados** y activa **Fathom Assistant**.

---

## 🛠️ Configuración (Ajustes del Plugin)

Ve a **Ajustes > Fathom Assistant** en Obsidian:

* **Gemini API Key:** *Obligatorio*. Introduce tu clave de API de Google Gemini.
* **Fathom Repo Path:** *Opcional*. Ruta física al repositorio de [Fathom Notebook](https://github.com/sergioomoya/fathom-notebook) para permitir al asistente ejecutar herramientas de sincronización y configuración de clientes.
* **Carpeta de Chats:** Nombre de la carpeta de historial (por defecto `Fathom Chats`). El plugin la mantendrá oculta de las búsquedas y del grafo de la bóveda de forma automática.

