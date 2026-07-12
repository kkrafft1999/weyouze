const test = require('node:test');
const assert = require('node:assert/strict');
const providers = require('../src/main/providers');
const { createSettingsPresentationService } = require('../src/main/services/settings-presentation-service');

const presentation = createSettingsPresentationService({
  providers,
  defaultProviderId: 'openai',
});

test('every registered provider exposes presentation metadata', () => {
  for (const id of providers.PROVIDER_ORDER) {
    const p = providers.getProvider(id);
    assert.ok(p.presentation, `${id} must define presentation`);
    if (p.fields?.apiKey) {
      assert.equal(typeof p.presentation.apiKeyPlaceholder, 'string');
    }
    if (p.fields?.baseUrl) {
      assert.equal(typeof p.presentation.baseUrlPlaceholder, 'string');
      assert.equal(p.presentation.connectionDetail, true);
    }
  }
});

test('buildLlmStateDto returns normalized preset and provider views', () => {
  const dto = presentation.buildLlmStateDto({
    encryptionAvailable: true,
    config: {
      activeProvider: 'openai',
      activePresetId: 'p1',
      presets: [
        {
          id: 'p1',
          providerId: 'openai',
          model: 'gpt-4o-mini',
          reasoningEffort: 'medium',
          menuVisible: true,
        },
        {
          id: 'p2',
          providerId: 'ollama',
          model: 'llama3.2',
          menuVisible: true,
        },
      ],
      providers: {
        openai: { apiKeyEnc: 'abc', model: 'gpt-4o-mini' },
        ollama: { baseUrl: 'http://127.0.0.1:11434' },
      },
    },
    chatTarget: {
      providerId: 'openai',
      model: 'gpt-4o-mini',
      reasoningEffort: 'medium',
    },
  });

  assert.equal(dto.encryptionAvailable, true);
  assert.equal(dto.activePresetId, 'p1');
  assert.equal(dto.presets.length, 2);

  const openaiPreset = dto.presets.find((p) => p.id === 'p1');
  assert.equal(openaiPreset.label, 'OpenAI · gpt-4o-mini');
  assert.equal(openaiPreset.sublabel, 'reasoning_effort: medium');
  assert.equal(openaiPreset.sublabelStyle, 'mono');
  assert.equal(openaiPreset.configured, true);

  const ollamaPreset = dto.presets.find((p) => p.id === 'p2');
  assert.match(ollamaPreset.sublabel, /Server: 127\.0\.0\.1:11434/);
  assert.match(ollamaPreset.sublabel, /TLS geprüft/);

  const openaiProvider = dto.providers.find((p) => p.id === 'openai');
  assert.equal(openaiProvider.form.showApiKey, true);
  assert.equal(openaiProvider.form.apiKeyPlaceholder, 'sk-…');
  assert.equal(openaiProvider.presetFields.length, 1);
  assert.equal(openaiProvider.presetFields[0].key, 'reasoningEffort');
  assert.equal(openaiProvider.isActiveChatProvider, true);
  assert.equal(openaiProvider.fields, undefined);

  const ollamaProvider = dto.providers.find((p) => p.id === 'ollama');
  assert.equal(ollamaProvider.form.showBaseUrl, true);
  assert.equal(ollamaProvider.connectionDetail, true);
  assert.equal(ollamaProvider.fields, undefined);
});

test('buildPresetView respects connection draft overrides', () => {
  const providerViewsById = {
    ollama: {
      id: 'ollama',
      name: 'Ollama (lokal)',
      defaultModel: 'llama3.2',
      baseUrl: 'http://127.0.0.1:11434',
      insecureTls: false,
      configured: true,
      connectionDetail: true,
    },
  };
  const view = presentation.buildPresetView(
    { id: 'p1', providerId: 'ollama', model: 'llama3.2', menuVisible: true },
    providerViewsById,
    { ollama: { baseUrl: 'https://draft.local', insecureTls: true } }
  );
  assert.match(view.sublabel, /draft\.local/);
  assert.match(view.sublabel, /TLS insecure/);
});
