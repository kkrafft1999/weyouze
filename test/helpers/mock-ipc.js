function createMockIpcMain() {
  const handlers = new Map();
  return {
    handle(channel, fn) {
      handlers.set(channel, fn);
    },
    on(channel, fn) {
      handlers.set(channel, fn);
    },
    invoke(channel, ...args) {
      const fn = handlers.get(channel);
      if (!fn) throw new Error(`No handler registered for ${channel}`);
      return fn({ sender: null }, ...args);
    },
  };
}

module.exports = { createMockIpcMain };
