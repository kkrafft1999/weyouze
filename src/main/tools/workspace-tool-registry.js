const { resolveDebugWaitMs } = require('../../shared/contracts/debug-wait');
const { sleepAbortable } = require('../../shared/runtime/abort');

function toAllowedNameSet(allowedNames) {
  if (allowedNames == null) return null;
  return new Set(allowedNames);
}

function createToolRegistry(initialDefinitions = []) {
  const definitions = new Map();

  function register(definition) {
    const { name, description, parameters, handler } = definition || {};
    if (!name || typeof description !== 'string' || !parameters || typeof handler !== 'function') {
      throw new TypeError('Tool benötigt name, description, parameters und handler.');
    }
    if (definitions.has(name)) {
      throw new Error(`Tool bereits registriert: ${name}`);
    }
    definitions.set(name, {
      ...definition,
      requiresWrite: definition.requiresWrite === true,
    });
  }

  function getAvailableDefinitions({ allowWrite = false, allowedNames } = {}) {
    const allowed = toAllowedNameSet(allowedNames);
    return [...definitions.values()].filter(
      (definition) =>
        (!definition.requiresWrite || allowWrite) &&
        (!allowed || allowed.has(definition.name))
    );
  }

  function getTools(options = {}) {
    return getAvailableDefinitions(options).map((definition) => ({
      type: 'function',
      function: {
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters,
      },
    }));
  }

  function buildSystemPrompt(options = {}) {
    const available = getAvailableDefinitions(options);
    if (available.length === 0) return '';

    const toolLines = available.map(
      (definition) =>
        `- ${definition.name}: ${definition.promptDescription || definition.description}`
    );
    let prompt =
      `Du hast folgende Tools zur Verfügung:\n${toolLines.join('\n')}\n` +
      `Nutze für Datei-Tools nur relative Pfade zum Ordnerroot ` +
      `(z. B. "" oder "." für die Wurzel, "src/index.js" für eine Datei).`;

    if (available.some((definition) => definition.requiresWrite)) {
      prompt +=
        ` Nutze Schreib-Tools zurückhaltend: nur wenn der Nutzer ausdrücklich eine Änderung oder neue Datei wünscht, ` +
        `und fasse danach kurz zusammen, was du geschrieben hast.`;
    }
    return prompt;
  }

  async function execute(name, args, context = {}) {
    const definition = definitions.get(name);
    if (!definition) {
      return JSON.stringify({ error: `Unbekanntes Tool: ${name}` });
    }
    if (definition.requiresWrite && context.allowWrite !== true) {
      return JSON.stringify({
        error: 'Schreibzugriff ist deaktiviert. Aktivierbar unter Einstellungen › Tools.',
      });
    }
    const allowed = toAllowedNameSet(context.allowedNames);
    if (allowed && !allowed.has(name)) {
      return JSON.stringify({ error: `Tool ist nicht freigeschaltet: ${name}` });
    }
    return definition.handler(args || {}, context);
  }

  initialDefinitions.forEach(register);

  return {
    register,
    getTools,
    buildSystemPrompt,
    execute,
  };
}

function createWorkspaceToolRegistry({ fsService }) {
  return createToolRegistry([
    {
      name: 'list_directory',
      description:
        'Listet Dateien und Unterordner in einem Verzeichnis relativ zum geöffneten Projektordner (ohne versteckte Einträge, die mit . beginnen).',
      promptDescription: 'Listet Dateien und Unterordner im Projektordner auf.',
      parameters: {
        type: 'object',
        properties: {
          relative_path: {
            type: 'string',
            description:
              'Relativer Pfad zum Ordner; leerer String oder "." für das Projektroot.',
          },
        },
      },
      handler: (args, { workspaceRoot }) =>
        fsService.runListDirectoryTool(args, workspaceRoot),
    },
    {
      name: 'read_file_text',
      description:
        'Liest den Textinhalt einer Datei als UTF-8 (nur innerhalb des Projektordners). ' +
        'Maximale Dateigröße: 2 MB — größere Dateien liefern einen Fehler.',
      promptDescription: 'Liest Textdateien innerhalb des Projektordners.',
      parameters: {
        type: 'object',
        properties: {
          relative_path: {
            type: 'string',
            description: 'Relativer Pfad zur Datei, z. B. "package.json" oder "src/app.js".',
          },
          max_characters: {
            type: 'integer',
            description:
              'Maximale Zeichenanzahl des zurückgegebenen Texts (Standard 32000, Obergrenze 200000).',
          },
        },
        required: ['relative_path'],
      },
      handler: (args, { workspaceRoot }) =>
        fsService.runReadFileTextTool(args, workspaceRoot),
    },
    {
      name: 'debug_wait',
      description:
        'Nur zum UI-Test: wartet eine konfigurierbare Zeit und liefert danach OK zurück. Kein Dateizugriff.',
      promptDescription: 'Wartet ausschließlich für UI-Tests eine kurze Zeit.',
      parameters: {
        type: 'object',
        properties: {
          duration_seconds: {
            type: 'number',
            description:
              'Wartezeit in Sekunden (Standard 5, Minimum 0,5, Maximum 20).',
          },
        },
      },
      async handler(args, { abortSignal }) {
        const ms = resolveDebugWaitMs(args);
        await sleepAbortable(ms, abortSignal);
        return JSON.stringify({ ok: true, waited_ms: ms, waited_seconds: ms / 1000 });
      },
    },
    {
      name: 'write_file_text',
      description:
        'Erstellt oder überschreibt eine Textdatei (UTF-8) innerhalb des geöffneten Projektordners. ' +
        'Fehlende Zwischenordner werden automatisch angelegt. Überschreibt vorhandenen Inhalt vollständig. ' +
        'Maximale Inhaltsgröße: 2 MB.',
      promptDescription: 'Erstellt oder überschreibt Textdateien im Projektordner.',
      parameters: {
        type: 'object',
        properties: {
          relative_path: {
            type: 'string',
            description: 'Relativer Pfad zur Zieldatei, z. B. "src/notes.md" oder "docs/neu.md".',
          },
          content: {
            type: 'string',
            description: 'Vollständiger neuer Textinhalt der Datei.',
          },
        },
        required: ['relative_path', 'content'],
      },
      requiresWrite: true,
      handler: (args, { workspaceRoot }) =>
        fsService.runWriteFileTextTool(args, workspaceRoot),
    },
  ]);
}

module.exports = {
  createToolRegistry,
  createWorkspaceToolRegistry,
};
