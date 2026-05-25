const path = require("path");
const { app, BrowserWindow } = require("electron");
const { startQueueWorker } = require("./queueWorker");

function createWindow() {

  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    icon: path.join(__dirname, "assets", "icons", "512x512.png"),
  });

  win.loadFile("index.html");

}

app.whenReady().then(() => {

  createWindow();
  startQueueWorker();

});
