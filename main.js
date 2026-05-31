const path = require("path");
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const QRCode = require("qrcode");
const { loadEnvFile } = require("./env");
const { setupProcessErrorHandlers, setupAutoStart, startWithWatchdog } = require("./watchdog");
const {
  QR_REFRESH_SECONDS,
  checkInternetClock,
  createQrUploadUrl,
  getQrConfig,
} = require("./qr");

loadEnvFile();
setupProcessErrorHandlers();

let mainWindow;
let qrState = {
  ok: false,
  loading: true,
  error: "QR is starting.",
};
let qrTimer;
let clockStatus = {
  ok: false,
  message: "Clock check pending.",
};

function publishQrState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("qr:state", qrState);
  }
}

async function refreshQr() {
  const config = getQrConfig();

  if (!config.ok) {
    qrState = {
      ok: false,
      error: config.error,
      serverHint: "For local development set PUBLIC_WEBSITE_URL=http://localhost:3000.",
    };
    publishQrState();
    return;
  }

  try {
    const nextRefreshAt = Date.now() + QR_REFRESH_SECONDS * 1000;
    const qrUpload = await createQrUploadUrl(config);
    const qrDataUrl = await QRCode.toDataURL(qrUpload.url, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 480,
      color: {
        dark: "#111827",
        light: "#ffffff",
      },
    });

    qrState = {
      ok: true,
      qrDataUrl,
      expiresAt: qrUpload.expires * 1000,
      nextRefreshAt,
      shopId: config.shopId,
      qrValiditySeconds: config.qrValiditySeconds,
      isLocalDevelopment: config.isLocalDevelopment,
      clockStatus,
    };
  } catch (err) {
    qrState = {
      ok: false,
      error: `Could not generate the QR code: ${err.message}`,
    };
  }

  publishQrState();
}

async function refreshClockStatus() {
  clockStatus = await checkInternetClock();

  if (qrState.ok) {
    qrState = {
      ...qrState,
      clockStatus,
    };
    publishQrState();
  }
}

function startQrRotation() {
  refreshQr();
  refreshClockStatus();

  qrTimer = setInterval(() => {
    refreshQr();
    refreshClockStatus();
  }, QR_REFRESH_SECONDS * 1000);
}

function createWindow() {

  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    icon: path.join(__dirname, "assets", "icons", "512x512.png"),
    autoHideMenuBar: true,   // hide menu bar – cleaner kiosk look
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.maximize();           // fill the screen on every startup
  mainWindow.loadFile("index.html");

  // Intercept the close button – ask for confirmation before quitting.
  // This prevents staff from accidentally closing the kiosk display.
  mainWindow.on("close", (event) => {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: "question",
      buttons: ["Keep Running", "Close App"],
      defaultId: 0,
      cancelId: 0,
      title: "Close PrintQ Agent?",
      message: "Closing PrintQ Agent will stop the print queue and the QR display.",
      detail: "Are you sure you want to close the app?",
    });

    if (choice === 0) {
      event.preventDefault(); // staff clicked "Keep Running" – do nothing
    }
  });

}

ipcMain.handle("qr:get-state", () => qrState);

app.whenReady().then(() => {

  createWindow();
  startQrRotation();
  setupAutoStart(app);

  try {
    const { startQueueWorker } = require("./queueWorker");
    startWithWatchdog(startQueueWorker);
  } catch (error) {
    console.error("Print queue worker did not start:", error.message);
  }

});

app.on("window-all-closed", () => {
  if (qrTimer) clearInterval(qrTimer);

  if (process.platform !== "darwin") {
    app.quit();
  }
});
