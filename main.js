const path = require("path");
const { app, BrowserWindow, ipcMain } = require("electron");
const QRCode = require("qrcode");
const { loadEnvFile } = require("./env");
const {
  QR_REFRESH_SECONDS,
  checkInternetClock,
  createQrUploadUrl,
  getQrConfig,
} = require("./qr");

loadEnvFile();

let mainWindow;
let qrState = {
  ok: false,
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
    const qrUpload = createQrUploadUrl(config);
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
  } catch {
    qrState = {
      ok: false,
      error: "Could not generate the QR code.",
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
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadFile("index.html");

}

ipcMain.handle("qr:get-state", () => qrState);

app.whenReady().then(() => {

  createWindow();
  startQrRotation();

  try {
    const { startQueueWorker } = require("./queueWorker");
    startQueueWorker();
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
