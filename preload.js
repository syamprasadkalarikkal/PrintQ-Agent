const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("printqQr", {
  getState: () => ipcRenderer.invoke("qr:get-state"),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("qr:state", listener);
    return () => ipcRenderer.removeListener("qr:state", listener);
  },
});
