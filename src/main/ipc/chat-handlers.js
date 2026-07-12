const { CHAT_ENGINE_EVENTS, resolveToolRoundLimit } = require('../chat-engine');
const { createRawLogPresentationService } = require('../services/raw-log-presentation-service');

function registerChatHandlers({
  ipcMain,
  chatEngine,
  REQ,
  PUSH,
  rawLogPresentation,
}) {
  const engine = chatEngine;
  const presentation = rawLogPresentation || createRawLogPresentationService();

  const eventChannels = {
    [CHAT_ENGINE_EVENTS.DELTA]: PUSH.CHAT_DELTA,
    [CHAT_ENGINE_EVENTS.TOOL_LINE]: PUSH.CHAT_TOOL_LINE,
    [CHAT_ENGINE_EVENTS.PROGRESS]: PUSH.CHAT_PROGRESS,
  };

  const forwardEvent = (webContents, event) => {
    const channel = eventChannels[event?.type];
    if (!channel || !webContents || webContents.isDestroyed() || typeof webContents.send !== 'function') return;
    webContents.send(channel, event.payload);
  };

  ipcMain.on(REQ.CHAT_ABORT, (event) => {
    engine.abort(event.sender.id);
  });

  ipcMain.handle(REQ.CHAT_EXPLAIN, (_event, payload) => {
    const messages = presentation.resolveExplainMessages(payload);
    if (!messages) {
      return engine.explain({ payload: { messages: [] } });
    }
    return engine.explain({ payload: { messages } });
  });

  ipcMain.handle(REQ.CHAT_SEND, async (event, payload) => {
    const result = await engine.send({
      sessionId: event.sender.id,
      payload,
      onEvent: (engineEvent) => forwardEvent(event.sender, engineEvent),
    });
    return presentation.enrichSendResult(result, payload);
  });
}

module.exports = {
  registerChatHandlers,
  resolveToolRoundLimit,
};
