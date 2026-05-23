const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeProviderPatchIntoConfigImpl } = require('../src/main/ipc/settings-handlers');

const mockProviders = {
  getProvider(id) {
    if (id === 'openai') {
      return { defaultModel: 'gpt-4o', fields: { apiKey: true } };
    }
    if (id === 'ollama') {
      return { defaultModel: 'llama3', fields: { baseUrl: true } };
    }
    return null;
  },
};

function makeDeps(encryptionAvailable = true) {
  return {
    safeStorage: {
      isEncryptionAvailable: () => encryptionAvailable,
      encryptString(plaintext) {
        return Buffer.from(`enc:${plaintext}`, 'utf8');
      },
    },
    providers: mockProviders,
  };
}

test('mergeProviderPatchIntoConfigImpl removes apiKeyEnc when removeApiKey is true', () => {
  const config = {
    providers: {
      openai: {
        apiKeyEnc: 'stored-key',
        model: 'gpt-4o',
      },
    },
  };

  const res = mergeProviderPatchIntoConfigImpl(makeDeps(), config, 'openai', {
    removeApiKey: true,
  });

  assert.equal(res.ok, true);
  assert.equal(config.providers.openai.apiKeyEnc, undefined);
  assert.equal(config.providers.openai.model, 'gpt-4o');
});

test('mergeProviderPatchIntoConfigImpl replaces key after removal when new apiKey is set', () => {
  const config = {
    providers: {
      openai: {
        apiKeyEnc: 'stored-key',
      },
    },
  };

  const res = mergeProviderPatchIntoConfigImpl(makeDeps(), config, 'openai', {
    removeApiKey: true,
    apiKey: 'new-secret',
  });

  assert.equal(res.ok, true);
  assert.equal(config.providers.openai.apiKeyEnc, Buffer.from('enc:new-secret', 'utf8').toString('base64'));
});

test('mergeProviderPatchIntoConfigImpl does not require encryption for removal only', () => {
  const config = {
    providers: {
      openai: {
        apiKeyEnc: 'stored-key',
      },
    },
  };

  const res = mergeProviderPatchIntoConfigImpl(makeDeps(false), config, 'openai', {
    removeApiKey: true,
  });

  assert.equal(res.ok, true);
  assert.equal(config.providers.openai.apiKeyEnc, undefined);
});
