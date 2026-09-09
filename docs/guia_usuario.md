# Guía de Usuario - Obsidian Fathom Assistant

Bienvenido a la guía de uso de **Fathom Assistant**, tu copiloto de Inteligencia Artificial integrado directamente en el panel lateral de Obsidian.

---

## 1. Instalación y Puesta en Marcha

1. Abre Obsidian y dirígete a **Ajustes > Opciones de la comunidad > Plugins instalados**.
2. Asegúrate de que el plugin **Fathom Assistant** esté activado.
3. En la barra lateral derecha de Obsidian, haz clic en el icono del robot para abrir el panel de Fathom Assistant.

---

## 2. Configuración Inicial

Dirígete a **Ajustes > Fathom Assistant**:

- **Gemini API Key (Obligatorio):** Introduce tu clave de API de Google AI Studio.
- **Fathom Repo Path (Opcional):** Ruta a la carpeta de tu repositorio de Fathom Notebook (ej: `c:\Programacion\Github\Fathom Notebook`). Es necesario si deseas que el asistente ejecute herramientas locales (mapeo de clientes, forzado de participantes o sincronización).
- **Carpeta de Chats:** Nombre de la carpeta donde se guardarán tus conversaciones (por defecto `Fathom Chats`). *Nota: El plugin ocultará automáticamente esta carpeta de tus búsquedas globales y del grafo de notas para no generar ruido.*

---

## 3. Interfaz del Asistente

La interfaz está diseñada para ser minimalista, limpia y sin distracciones:

### 3.1. Cabecera (Header)
- **Título del Chat:** Haz clic sobre el título para renombrar la conversación actual.
- **Selector de Conversaciones:** Desplegable dinámico para alternar entre tus conversaciones guardadas.
- **Botón `+` (Nueva Conversación):** Inicia una conversación en blanco.
- **Botón Carpeta:** Revela la carpeta de chats en el explorador de notas de Obsidian.

### 3.2. Pie de Chat (Footer)
- **Selector de Modelo:** Cambia en cualquier momento el modelo de IA que responderá a tu mensaje:
  - `Gemini 3.7 Flash` (Rápido y con capacidades avanzadas de razonamiento)
  - `Gemini 3.6 Flash / Pro`
  - `Gemini 3.1 Flash / Pro`
  - `Gemini 2.5 Flash / Pro`
- **Botón `+` (Adjuntos):** Abre el explorador de archivos para adjuntar imágenes a la consulta.

---

## 4. Conciencia del Contexto (Context-Aware)

Puedes alimentar al asistente con la información de tus notas sin copiar y pegar texto:

### Añadir Notas o Carpetas al Contexto
1. En el explorador de archivos de Obsidian, haz **clic derecho** sobre cualquier nota o carpeta.
2. Selecciona la opción **"Añadir contexto a Fathom Assistant"**.
3. Verás que en el panel de chat aparece una pastilla (chip) con el nombre de la nota o carpeta.
4. Escribe tu pregunta (ej: *"Resume los puntos acordados en esta reunión"* o *"¿Cuáles son las tareas pendientes de este cliente?"*).
5. El modelo analizará los documentos seleccionados para darte una respuesta precisa basada en tus notas.

---

## 5. Trabajo Multimodal (Imágenes y Portapapeles)

Fathom Assistant soporta análisis de imágenes:
- **Pegar desde el Portapapeles (`Ctrl + V`):** Si tomas una captura de pantalla, pulsa `Ctrl + V` en el cuadro de texto del chat y la imagen se adjuntará automáticamente.
- **Arrastrar y Soltar:** Arrastra una imagen directamente sobre el panel del asistente.
- **Examinar Archivos:** Haz clic en el botón `+` del pie de chat para seleccionar una imagen desde tu equipo.

---

## 6. Control de Respuestas

### Cancelar una Respuesta en Curso
Si la IA está generando una respuesta y deseas detenerla (por ejemplo, porque te diste cuenta de que faltó contexto):
- Haz clic en el **cuadrado rojo** de parada que sustituye al botón de envío.
- La petición se cancelará instantáneamente liberando la conexión.

### Copiar Respuestas en Markdown Puro
Al pasar el cursor sobre cualquier respuesta del asistente, verás aparecer un botón flotante con un icono de portapapeles en la esquina superior derecha del mensaje.
- Haz clic en él para copiar la respuesta en formato Markdown puro (manteniendo intactas tablas, listas y bloques de código).

---

## 7. Herramientas Autónomas del Agente

Si has configurado la ruta de Fathom Notebook (`fathomRepoPath`), puedes pedirle al asistente que realice acciones por ti mediante lenguaje natural:

- *"¿Qué dice la nota que tengo abierta ahora mismo?"* $ightarrow$ Ejecuta `read_current_note`.
- *"Busca notas relacionadas con la auditoría de calidad"* $ightarrow$ Ejecuta `query_vault`.
- *"Asocia el dominio acme.com al cliente Acme Corp en Fathom"* $ightarrow$ Ejecuta `add_domain_mapping`.
- *"Fuerza a Juan y Pedro como asistentes en la reunión 12345"* $ightarrow$ Ejecuta `inject_participants`.
- *"Sincroniza las reuniones de Fathom"* $ightarrow$ Ejecuta `trigger_fathom_sync`.
