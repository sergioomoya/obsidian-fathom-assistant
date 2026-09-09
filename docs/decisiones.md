# Registro de Decisiones (ADR) - Obsidian Fathom Assistant

Este documento registra las decisiones arquitectónicas fundamentales tomadas durante el desarrollo del plugin **Obsidian Fathom Assistant**.

---

## ADR 1: Adopción del SDK Oficial `@google/genai` v2.x y Normalización de Carga Útil
- **Estado:** Aceptada
- **Contexto:** Se requería conectar con los modelos más recientes de Gemini (2.5, 3.1, 3.6, 3.7). Las versiones anteriores del SDK presentaban validaciones rígidas en `ContentUnion` que fallaban al mezclar texto simple con llamadas a herramientas.
- **Decisión:** Implementar el SDK oficial `@google/genai` v2.x, normalizando los envíos: si el mensaje es solo texto, se envía como string primitivo; si incluye adjuntos, se estructura como array de partes.
- **Consecuencias:** Estabilidad absoluta en llamadas a la API y compatibilidad completa con todos los modelos de Google Gemini.

---

## ADR 2: Auto-Exclusión Programática de la Carpeta de Chats en `userIgnoreFilters`
- **Estado:** Aceptada
- **Contexto:** Guardar las conversaciones en Markdown dentro de la bóveda de Obsidian provocaba que aparecieran en los resultados de búsqueda global y en el grafo de notas, contaminando el conocimiento estructurado del usuario.
- **Decisión:** Al iniciar el plugin, se inyecta programáticamente la carpeta de chats (ej: `Fathom Chats`) en la configuración interna `userIgnoreFilters` de Obsidian.
- **Consecuencias:** Los chats se mantienen seguros y respaldados en disco, pero son invisibles en la búsqueda general y en el grafo de la bóveda, manteniendo el espacio de trabajo limpio.

---

## ADR 3: Arquitectura UI en Dos Capas (Área de Texto + Footer de Controles)
- **Estado:** Aceptada
- **Contexto:** Las interfaces de chat tradicionales sobrecargan el cuadro de texto con botones invasivos oselectores flotantes que reducen el espacio de escritura en paneles laterales estrechos.
- **Decisión:** Diseñar una interfaz inspirada en el chat de Antigravity: una caja de entrada autoexpansible superior y un pie de chat sutil inferior con selector de modelo y botón de adjuntos discreto.
- **Consecuencias:** Máximo aprovechamiento del espacio visual y experiencia de usuario fluida y profesional.

---

## ADR 4: Aborto Instantáneo mediante `AbortController`
- **Estado:** Aceptada
- **Contexto:** Si el modelo genera una respuesta no deseada o muy extensa, el usuario no disponía de un mecanismo para detener la ejecución, gastando cuota de tokens innecesariamente.
- **Decisión:** Integrar un botón de parada (cuadrado rojo) enlazado a un `AbortController` local que cancela inmediatamente el socket de red y el bucle de procesamiento.
- **Consecuencias:** Cancelación en tiempo real al milisegundo sin congelamiento de la interfaz.

---

## ADR 5: Desacoplamiento de Herramientas mediante Invocación de CLI sobre Fathom Notebook
- **Estado:** Aceptada
- **Contexto:** Fathom Assistant requería interactuar con el backend de Fathom Notebook (añadir mapeos de dominios, registrar participantes forzados, sincronizar grabaciones).
- **Decisión:** En lugar de importar dependencias cruzadas de Node.js o acoplar librerías, `ToolExecutor` ejecuta comandos CLI mediante `child_process.exec` sobre el directorio del backend (`npm run cli ...`).
- **Consecuencias:** Desacoplamiento arquitectónico total. Si Fathom Notebook se actualiza o cambia internamente, el plugin de Obsidian no sufre roturas de dependencias.
