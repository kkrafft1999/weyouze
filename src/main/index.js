/**
 * Main-process entry point prepared for the Phase 2 modularization.
 *
 * This file is intentionally not active yet: package.json still points to
 * main.js until Phase 2.8 switches the Electron entry point.
 *
 * Startup responsibilities to move here step by step:
 * 1. Register runtime permissions before creating renderer-facing windows.
 * 2. Create and own the BrowserWindow lifecycle.
 * 3. Instantiate main-process services once and pass them into IPC handlers.
 * 4. Register all IPC handlers after their dependencies are constructed.
 */
