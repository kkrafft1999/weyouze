const test = require('node:test');
const assert = require('node:assert/strict');
const { createCredentialAdapter } = require('../src/main/adapters/credential-adapter');

test('credential adapter returns apiKey from provider secrets', async () => {
  const adapter = createCredentialAdapter({
    providerSecrets: {
      getEffectiveProviderConfig: async (providerId) => {
        assert.equal(providerId, 'openai');
        return { apiKey: 'sk-secret', model: 'gpt-4o' };
      },
    },
  });

  assert.equal(await adapter.getApiKey('openai'), 'sk-secret');
});

test('credential adapter returns null when provider secrets have no key', async () => {
  const adapter = createCredentialAdapter({
    providerSecrets: {
      getEffectiveProviderConfig: async () => ({ model: 'gpt-4o' }),
    },
  });

  assert.equal(await adapter.getApiKey('openai'), null);
});
