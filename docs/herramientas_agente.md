# Catálogo de Herramientas del Agente - Obsidian Fathom Assistant

Este documento detalla las especificaciones técnicas, esquemas y comportamiento de las herramientas (`agentTools`) que el modelo de Inteligencia Artificial puede invocar durante una conversación.

---

## 1. `read_current_note`

- **Descripción:** Lee el contenido completo de la nota que el usuario tiene abierta en ese momento en el editor activo de Obsidian.
- **Capa:** Vault API de Obsidian.
- **Parámetros:** Ninguno.
- **Retorno:** Cadena con el nombre de la nota y su contenido íntegro en Markdown. Si no hay ninguna nota abierta, retorna un mensaje descriptivo informándolo.
- **Caso de uso típico:** *"¿Qué opinas de lo que acabo de escribir en esta nota?"* o *"Traduce los puntos clave de este documento"*.

---

## 2. `query_vault`

- **Descripción:** Busca notas en la bóveda cuyos nombres coincidan con un término o frase clave.
- **Capa:** Vault API de Obsidian.
- **Parámetros:**
  ```json
  {
    "query": {
      "type": "STRING",
      "description": "Término o frase a buscar en los nombres de archivo de la bóveda"
    }
  }
  ```
- **Retorno:** Lista de rutas de archivos coincidentes (`- CLIENTES/EMPRESA/minutas.md`).
- **Caso de uso típico:** *"¿Tenemos alguna nota sobre la reunión de presupuesto?"*

---

## 3. `add_domain_mapping`

- **Descripción:** Añade una nueva regla al archivo de mapeo de clientes (`client-map.json`), asociando un dominio web de correo electrónico al nombre de una carpeta de cliente.
- **Capa:** CLI de Fathom Notebook (`npm run cli add-mapping "<domain>" "<company>"`).
- **Parámetros:**
  ```json
  {
    "domain": {
      "type": "STRING",
      "description": "Dominio web sin @ (ej: acme.com)"
    },
    "company": {
      "type": "STRING",
      "description": "Nombre de la carpeta de cliente asignada (ej: ACME CORP)"
    }
  }
  ```
- **Retorno:** Salida estándar del comando CLI confirmando la actualización del archivo de mapeo.
- **Caso de uso típico:** *"Por favor, asigna los correos de martiderm.es a la empresa MARTIDERM"*.

---

## 4. `inject_participants`

- **Descripción:** Registra una sobreescritura manual de participantes en el archivo `overrides.json` de Fathom Notebook para una sesión de grabación específica.
- **Capa:** CLI de Fathom Notebook (`npm run cli add-override "<recording_id>" "<participants>"`).
- **Parámetros:**
  ```json
  {
    "recording_id": {
      "type": "STRING",
      "description": "Identificador único de la grabación de Fathom"
    },
    "participants": {
      "type": "STRING",
      "description": "Lista de nombres de participantes separados por coma (ej: Juan Pérez, María López)"
    }
  }
  ```
- **Retorno:** Confirmación del CLI indicando que la sobreescritura ha sido registrada.
- **Caso de uso típico:** *"En la grabación con ID 98765, los participantes reales fueron Ana García y Carlos Gómez"*.

---

## 5. `trigger_fathom_sync`

- **Descripción:** Dispara el proceso principal de sincronización de Fathom Notebook para consultar la API, descargar nuevas reuniones, generar actas y actualizar planes de acción.
- **Capa:** CLI de Fathom Notebook (`npm run cli sync`).
- **Parámetros:** Ninguno.
- **Retorno:** Salida del log de ejecución del proceso de sincronización.
- **Caso de uso típico:** *"Sincroniza las reuniones más recientes de Fathom"*.
