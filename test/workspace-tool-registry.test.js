const test = require('node:test');
const assert = require('node:assert/strict');
const { createToolRegistry } = require('../src/main/tools/workspace-tool-registry');

function definition(name, { requiresWrite = false } = {}) {
  return {
    name,
    description: `Beschreibung für ${name}`,
    promptDescription: `Prompt für ${name}`,
    parameters: {
      type: 'object',
      properties: {
        value: { type: 'string' },
      },
    },
    requiresWrite,
    handler: async (args, context) =>
      JSON.stringify({ name, value: args.value, workspaceRoot: context.workspaceRoot }),
  };
}

test('registry exposes registered tools in provider format', () => {
  const registry = createToolRegistry([definition('read')]);

  assert.deepEqual(registry.getTools(), [
    {
      type: 'function',
      function: {
        name: 'read',
        description: 'Beschreibung für read',
        parameters: {
          type: 'object',
          properties: {
            value: { type: 'string' },
          },
        },
      },
    },
  ]);
});

test('registry filters write tools and allowed tool names consistently', () => {
  const registry = createToolRegistry([
    definition('read'),
    definition('other'),
    definition('write', { requiresWrite: true }),
  ]);

  assert.deepEqual(
    registry.getTools().map((tool) => tool.function.name),
    ['read', 'other']
  );
  assert.deepEqual(
    registry
      .getTools({ allowWrite: true, allowedNames: ['read', 'write'] })
      .map((tool) => tool.function.name),
    ['read', 'write']
  );

  const prompt = registry.buildSystemPrompt({
    allowWrite: true,
    allowedNames: ['read', 'write'],
  });
  assert.match(prompt, /read/);
  assert.match(prompt, /write/);
  assert.doesNotMatch(prompt, /other/);
  assert.match(prompt, /Schreib-Tools zurückhaltend/);
});

test('registry executes handlers with request context', async () => {
  const registry = createToolRegistry([definition('read')]);

  const result = JSON.parse(
    await registry.execute(
      'read',
      { value: 'hello' },
      { workspaceRoot: '/tmp/project' }
    )
  );

  assert.deepEqual(result, {
    name: 'read',
    value: 'hello',
    workspaceRoot: '/tmp/project',
  });
});

test('registry rejects unavailable, unknown and duplicate tools', async () => {
  const registry = createToolRegistry([
    definition('read'),
    definition('write', { requiresWrite: true }),
  ]);

  assert.match(JSON.parse(await registry.execute('write', {})).error, /Schreibzugriff/);
  assert.match(
    JSON.parse(
      await registry.execute('read', {}, { allowedNames: ['write'] })
    ).error,
    /nicht freigeschaltet/
  );
  assert.match(JSON.parse(await registry.execute('missing', {})).error, /Unbekanntes Tool/);
  assert.throws(() => registry.register(definition('read')), /bereits registriert/);
});
