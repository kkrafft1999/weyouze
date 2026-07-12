'use strict';

const { createRoundRecorder } = require('../llm-raw-log');

function createRawExchangeAdapter() {
  return {
    createRoundRecorder,
  };
}

module.exports = {
  createRawExchangeAdapter,
};
