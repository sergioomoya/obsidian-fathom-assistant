# Fathom Assistant para Obsidian

Fathom Assistant es un plugin para Obsidian que integra un Agente Inteligente basado en el motor de **Google Gemini** directamente en el panel lateral de tu bóveda. 

Diseñado bajo la directiva de *Manifiesto del Artesano de Software*, Fathom prioriza una interfaz hiper-minimalista, limpia y fluida, ofreciendo al mismo tiempo capacidades avanzadas de razonamiento, conciencia del contexto de tus notas y ejecución de herramientas subyacentes.

---

## 🌟 Características Principales

*   **UI Dinámica e Inmersiva:** Una interfaz de chat dividida en "dos capas". Una caja de entrada de texto fluida, acompañada de un pie de chat sutil que expone de forma no intrusiva controles como el cambio de modelos en tiempo real y la adjunción de archivos.
*   **Conciencia del Contexto (Context-Aware):** Puedes hacer clic derecho en cualquier nota o carpeta de tu bóveda de Obsidian y seleccionar *"Añadir contexto a Fathom Assistant"*. El modelo ingerirá esa información en tiempo real para responder a tus preguntas basándose en tus propios datos.
*   **Gestión Nativa de Historial (Auto-Excluida):** Tus conversaciones se guardan como archivos Markdown puros en una carpeta designada. Para evitar contaminar tus búsquedas y tu gráfico de notas, el plugin **auto-excluye** esta carpeta utilizando las APIs internas de ignorado de Obsidian, manteniéndola invisible pero totalmente funcional.
*   **Botón de Aborto Instantáneo:** Equipado con un `AbortController` local, puedes cancelar la respuesta de la IA instantáneamente mediante el cuadrado rojo de la interfaz, liberando los recursos de la red al milisegundo.
*   **Copiado de Markdown con 1 Clic:** Copia las respuestas íntegras de la IA (incluyendo formato, tablas y bloques de código crudo) pulsando el pequeño botón flotante que aparece al pasar el ratón sobre cualquier mensaje del asistente.
*   **Soporte Multimodal (Imágenes y Adjuntos):** Soporta adjuntos nativos de imágenes, copiado y pegado directo desde el portapapeles (`Ctrl + V`), y subida mediante arrastre.
*   **Tool Executor Integrado:** Extiende las capacidades del modelo permitiéndole usar herramientas avanzadas (ej. llamadas a `scripts`, integración con un backend de Fathom).

---

## ⚙️ Requisitos

1.  **Obsidian** (versión de escritorio recomendada).
2.  **Node.js** y **NPM** (para compilar desde el código fuente).
3.  **Google Gemini API Key:** Necesaria para inicializar las peticiones al motor `@google/genai` (v2+).

---

## 🚀 Instalación y Compilación

Dado que Fathom Assistant es un plugin de desarrollo privado o compilado localmente, sigue estos pasos para instalarlo en tu bóveda de Obsidian:

1.  Abre tu terminal y navega hasta el directorio del plugin dentro de tu bóveda:
    ```bash
    cd /ruta-a-tu-boveda/.obsidian/plugins/fathom-assistant
    ```
2.  Instala las dependencias necesarias:
    ```bash
    npm install
    ```
3.  Compila el plugin:
    ```bash
    npm run build
    ```
4.  Abre Obsidian, ve a **Ajustes > Opciones de la comunidad > Plugins instalados** y activa "Fathom Assistant".

---

## 🛠️ Configuración (Ajustes del Plugin)

Una vez activado, dirígete a las opciones del plugin Fathom Assistant en Obsidian para configurar:

*   **Gemini API Key:** *Obligatorio*. Introduce tu clave de API de Google AI Studio.
*   **Fathom Repo Path:** Ruta del repositorio de backend/notebook si haces uso de las capacidades de ToolExecutor local.
*   **Carpeta de Chats:** Define el nombre de la carpeta (ej. `Fathom Chats`) donde se guardará el historial en Markdown. *Fathom la añadirá automáticamente a la lista negra visual de Obsidian por ti al arrancar.*

---

## 📐 Decisiones Técnicas (Changelog & Architecture)

*   **Arquitectura del SDK:** Construido sobre el moderno SDK `@google/genai` v2.x, eludiendo problemas de validación estricta de `ContentUnion` delegando envíos planos a la red.
*   **Flexbox y Desbordamientos:** Interfaz construida con directivas `flex-shrink: 0` y truncado dinámico para selectores de listas (ComboBox), garantizando que los elementos estéticos no se colapsen sin importar el tamaño del panel lateral en Obsidian.
*   **Estética "Antigravity":** Descartados componentes 3D nativos del SO y emojis por defecto en favor de grafismos vectoriales puristas (SVG integrados en DOM), transparencias calculadas y paleta de colores heredada estrictamente de tu tema activo (`var(--background-primary)`, `var(--text-muted)`).

---
*Hecho a mano para asegurar que cada línea sea mantenible, clara y escalable.*
