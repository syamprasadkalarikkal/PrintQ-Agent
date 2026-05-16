const { printHTML, detectPrinters } = require("./printer");

async function printWithWebContents(webContents, options = {}) {
  if (!webContents) {
    throw new Error("webContents is required for printing");
  }

  const debug = options.debug !== false;
  const { printer } = await detectPrinters(webContents, options);
  const printerName = printer.name;

  console.log(`[printer] Printing existing webContents with deviceName "${printerName}".`);

  return new Promise((resolve, reject) => {
    webContents.print(
      {
        silent: true,
        deviceName: printerName,
        printBackground: options.printBackground !== false,
        copies: Math.max(Number(options.copies) || 1, 1),
      },
      (success, failureReason) => {
        if (success) {
          if (debug) console.log("[printer] Print job sent successfully.");
          resolve({ success: true, printerName });
          return;
        }

        reject(new Error(`Print failed: ${failureReason || "unknown failure reason"}`));
      }
    );
  });
}

module.exports = {
  detectPrinters,
  printHTML,
  printWithWebContents,
};
