'use strict';

const { createProviderCatalogAdapter } = require('../../src/main/adapters/provider-catalog-adapter');

function createMockProviderRuntime(getProviderImpl, { listMeta } = {}) {
  return {
    getProvider(id) {
      return getProviderImpl(id) || null;
    },
    listProviderMeta() {
      if (listMeta) return listMeta();
      return [];
    },
    disposeAll() {},
  };
}

function createMockProviderCatalog(getProviderImpl, options) {
  return createProviderCatalogAdapter(createMockProviderRuntime(getProviderImpl, options));
}

module.exports = {
  createMockProviderRuntime,
  createMockProviderCatalog,
};
