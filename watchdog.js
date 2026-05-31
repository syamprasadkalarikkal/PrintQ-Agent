

const MAX_RESTARTS = 10;
const RESTART_COOLDOWN_MS = 5000;

/**
 * Register process-level handlers for uncaughtException and
 * unhandledRejection so the main process does not silently die.
 * These are deliberately non-fatal – we log and keep running.
 */
function setupProcessErrorHandlers() {
  process.on("uncaughtException", (error) => {
    console.error("[watchdog] Uncaught exception in main process:", error);
    // Do not call process.exit() — let Electron's own recovery run.
  });

  process.on("unhandledRejection", (reason) => {
    console.error("[watchdog] Unhandled promise rejection in main process:", reason);
  });
}

/**
 * Wrap a worker start function with automatic restart logic.
 *
 * @param {() => any} startFn  - The function to call to (re)start the worker.
 *                               Must be synchronous. Its return value (e.g. an
 *                               interval handle) is stored and cleared on each
 *                               restart cycle.
 * @returns {{ stop: () => void }} - Call stop() to cancel restarts permanently.
 */
function startWithWatchdog(startFn) {
  let workerHandle = null;
  let restartCount = 0;
  let stopped = false;

  function attempt() {
    if (stopped) return;

    try {
      workerHandle = startFn();
      restartCount = 0; // reset on clean start
      console.log("[watchdog] Queue worker running.");
    } catch (error) {
      console.error("[watchdog] Queue worker crashed:", error.message || error);
      scheduleRestart();
    }
  }

  function scheduleRestart() {
    if (stopped) return;

    if (restartCount >= MAX_RESTARTS) {
      console.error(
        `[watchdog] Queue worker failed ${MAX_RESTARTS} times in a row. ` +
          "Manual intervention required. The app window is still open."
      );
      return;
    }

    restartCount++;
    console.log(
      `[watchdog] Restarting queue worker in ${RESTART_COOLDOWN_MS / 1000}s ` +
        `(attempt ${restartCount}/${MAX_RESTARTS})…`
    );

    setTimeout(attempt, RESTART_COOLDOWN_MS);
  }

  attempt();

  return {
    stop() {
      stopped = true;
      if (workerHandle && typeof clearInterval === "function") {
        clearInterval(workerHandle);
      }
    },
  };
}

/**
 * Register the app as a Windows login item so it restarts automatically
 * after a reboot or user log-in.
 *
 * - Only active on Windows (no-op on other platforms).
 * - Set AUTO_START_ON_LOGIN=false in .env to disable.
 * - Has no effect when running in development (electron .) because the
 *   execPath points to the Electron binary, not the installed .exe.
 *
 * @param {Electron.App} app
 */
function setupAutoStart(app) {
  if (process.platform !== "win32") return;

  const enabled = process.env.AUTO_START_ON_LOGIN !== "false";

  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: false,
    name: "PrintQ Agent",
    path: process.execPath,
    args: [],
  });

  if (enabled) {
    console.log("[watchdog] Windows login item registered – app will start on login.");
  } else {
    console.log("[watchdog] Windows login item disabled (AUTO_START_ON_LOGIN=false).");
  }
}

module.exports = {
  setupProcessErrorHandlers,
  setupAutoStart,
  startWithWatchdog,
};
