'use strict';

function createUpdateAdapter(updateService) {
  return {
    getCurrentVersion() {
      return updateService.getCurrentVersion();
    },
    checkForUpdate(options) {
      return updateService.checkForUpdate(options);
    },
    ignoreVersion(version) {
      return updateService.ignoreVersion(version);
    },
  };
}

module.exports = {
  createUpdateAdapter,
};
