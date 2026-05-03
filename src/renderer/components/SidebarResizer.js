export function initSidebarResizer({ divider, sidebar, workspace, chatDivider, chatPanel }) {
  let isResizing = false;
  let isResizingChat = false;

  divider.addEventListener('mousedown', (e) => {
    isResizing = true;
    divider.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (isResizing) {
      const newWidth = Math.max(150, Math.min(e.clientX, 600));
      sidebar.style.width = `${newWidth}px`;
      return;
    }
    if (isResizingChat && workspace) {
      const rect = workspace.getBoundingClientRect();
      const fromRight = rect.right - e.clientX;
      const minChat = 260;
      const maxChat = Math.max(minChat, Math.min(rect.width * 0.5, rect.width - 200));
      const w = Math.max(minChat, Math.min(fromRight, maxChat));
      chatPanel.style.width = `${w}px`;
    }
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      divider.classList.remove('dragging');
      document.body.style.cursor = '';
    }
    if (isResizingChat) {
      isResizingChat = false;
      chatDivider.classList.remove('dragging');
      document.body.style.cursor = '';
    }
  });

  chatDivider.addEventListener('mousedown', (e) => {
    isResizingChat = true;
    chatDivider.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
  });
}
