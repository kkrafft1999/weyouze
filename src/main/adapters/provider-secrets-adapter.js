'use strict';

function createProviderSecretsPort(storage) {
  return {
    getEffectiveProviderConfig: (...args) => storage.getEffectiveProviderConfig(...args),
  };
}

module.exports = {
  createProviderSecretsPort,
};
