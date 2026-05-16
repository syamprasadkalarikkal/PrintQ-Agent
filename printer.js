const axios = require("axios");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { pipeline } = require("stream/promises");
const supabase = require("./supabase");

const STORAGE_BUCKET = process.env.PRINT_STORAGE_BUCKET || "print-queue";
const DEFAULT_PDF_DIR = path.join(os.homedir(), "PDF");
const DEFAULT_PRINT_DELAY_MS = 1500;
const DEFAULT_PRINT_TIMEOUT_MS = 60000;
const DEFAULT_PDF_WAIT_TIMEOUT_MS = 30000;
const DEFAULT_QUEUE_SETTLE_MS = 750;
const DEFAULT_ASSET_WAIT_TIMEOUT_MS = 5000;

function logDebug(enabled, ...args) {
  if (enabled) console.log("[printer]", ...args);
}

function logWarn(...args) {
  console.warn("[printer]", ...args);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getElectron() {
  const electron = require("electron");

  if (!electron?.app || !electron?.BrowserWindow) {
    throw new Error(
      "Electron printing must run in the Electron main process. Start the app with `electron .` or call printHTML() from main."
    );
  }

  return electron;
}

async function ensureAppReady(app) {
  if (app.isReady()) return;
  await app.whenReady();
}

function safeFileName(job) {
  const sourceName =
    job.original_file_name ||
    job.file_path ||
    job.file_url ||
    job.customer_token ||
    job.token ||
    job.id ||
    Date.now();

  const ext = path.extname(String(sourceName)) || ".pdf";
  const base = String(job.id || job.token || job.customer_token || Date.now())
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 80);

  return `${base}${ext}`;
}

async function downloadFromUrl(url, destination) {
  const response = await axios({
    url,
    method: "GET",
    responseType: "stream",
  });

  await pipeline(response.data, fs.createWriteStream(destination));
}

async function downloadFromStorage(filePath, destination) {
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .download(filePath);

  if (error) throw error;

  const arrayBuffer = await data.arrayBuffer();
  await fsp.writeFile(destination, Buffer.from(arrayBuffer));
}

function cupsOption(name, value) {
  return ["-o", `${name}=${value}`];
}

function buildPrintArgs(filePath, job) {
  const args = [];
  const printerName = process.env.PRINTER_NAME || process.env.PDF_PRINTER_NAME;

  if (printerName) {
    args.push("-d", printerName);
  }

  const copies = Math.max(Number(job.copies) || 1, 1);
  if (copies > 1) {
    args.push("-n", String(copies));
  }

  if (job.paper_size) {
    args.push(...cupsOption("media", job.paper_size));
  }

  if (String(job.orientation || "").toLowerCase() === "landscape") {
    args.push(...cupsOption("orientation-requested", "4"));
  }

  const colorMode = String(job.color_mode || "").toLowerCase();
  if (colorMode.includes("black") || colorMode.includes("white") || colorMode.includes("mono")) {
    args.push(...cupsOption("print-color-mode", "monochrome"));
  } else if (colorMode.includes("color")) {
    args.push(...cupsOption("print-color-mode", "color"));
  }

  const twoSided = String(job.two_sided || "").toLowerCase();
  if (twoSided.includes("short")) {
    args.push(...cupsOption("sides", "two-sided-short-edge"));
  } else if (twoSided.includes("long")) {
    args.push(...cupsOption("sides", "two-sided-long-edge"));
  } else if (twoSided.includes("single")) {
    args.push(...cupsOption("sides", "one-sided"));
  }

  const pagesPerSide = Number(job.pages_per_side);
  if ([2, 4, 6, 9, 16].includes(pagesPerSide)) {
    args.push(...cupsOption("number-up", String(pagesPerSide)));
  }

  args.push(filePath);
  return args;
}

function runLp(args) {
  return new Promise((resolve, reject) => {
    execFile("lp", args, { timeout: 120000 }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

function runCommand(command, args, timeout = 10000) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout }, (error, stdout, stderr) => {
      resolve({
        command: `${command} ${args.join(" ")}`,
        ok: !error,
        stdout: String(stdout || "").trim(),
        stderr: String(stderr || "").trim(),
        error: error ? error.message : null,
      });
    });
  });
}

async function logCupsState(printerName, debug) {
  const commands = [
    ["lpstat", ["-r"]],
    ["lpstat", ["-d"]],
    ["lpstat", ["-v"]],
  ];

  if (printerName) {
    commands.push(["lpstat", ["-p", printerName]]);
    commands.push(["lpstat", ["-o", printerName]]);
  } else {
    commands.push(["lpstat", ["-o"]]);
  }

  for (const [command, args] of commands) {
    const result = await runCommand(command, args);
    const output = [result.stdout, result.stderr, result.error].filter(Boolean).join(" | ");
    logDebug(debug, `$ ${result.command}`, output || "(no output)");
  }
}

function printerText(printer) {
  return [
    printer.name,
    printer.displayName,
    printer.description,
    printer.options?.["printer-info"],
    printer.options?.["printer-make-and-model"],
    printer.options?.["device-uri"],
    printer.options?.deviceUri,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function normalized(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function isPdfPrinter(printer) {
  const text = printerText(printer);
  return (
    /\bcups[-_\s]?pdf\b/i.test(text) ||
    /\bprint[-_\s]?to[-_\s]?pdf\b/i.test(text) ||
    /\bpdf[-_\s]?printer\b/i.test(text) ||
    /\bvirtual[-_\s]?pdf\b/i.test(text) ||
    normalized(printer.name) === "pdf" ||
    normalized(printer.displayName) === "pdf" ||
    text.includes("cups-pdf") ||
    text.includes("pdf")
  );
}

function describePrinter(printer) {
  return {
    name: printer.name,
    displayName: printer.displayName,
    description: printer.description,
    status: printer.status,
    isDefault: Boolean(printer.isDefault),
    options: printer.options,
  };
}

async function detectPrinters(webContents, options = {}) {
  if (!webContents?.getPrintersAsync) {
    throw new Error("A valid Electron webContents instance is required for getPrintersAsync().");
  }

  const debug = options.debug !== false;
  const preferredNames = [
    options.printerName,
    process.env.PDF_PRINTER_NAME,
    process.env.PRINTER_NAME,
    "CUPS-PDF",
    "CUPS_PDF",
    "Print_to_PDF",
    "Print to PDF",
    "PDF",
  ].filter(Boolean);

  const printers = await webContents.getPrintersAsync();
  logDebug(debug, `Detected ${printers.length} printer(s) with getPrintersAsync().`);

  for (const printer of printers) {
    logDebug(debug, "Printer:", JSON.stringify(describePrinter(printer), null, 2));
  }

  if (!printers.length) {
    throw new Error(
      "Electron did not detect any printers. Confirm CUPS is running (`lpstat -r`) and that the virtual PDF printer is installed."
    );
  }

  for (const preferredName of preferredNames) {
    const exact = printers.find(
      (printer) =>
        normalized(printer.name) === normalized(preferredName) ||
        normalized(printer.displayName) === normalized(preferredName)
    );

    if (exact) {
      logDebug(debug, `Selected printer by preferred name "${preferredName}": ${exact.name}`);
      return { printer: exact, printers, reason: `preferred:${preferredName}` };
    }
  }

  const pdfCandidates = printers.filter(isPdfPrinter);
  if (pdfCandidates.length) {
    const defaultPdf = pdfCandidates.find((printer) => printer.isDefault);
    const selected = defaultPdf || pdfCandidates[0];
    logDebug(debug, `Selected PDF-like printer: ${selected.name}`);
    return { printer: selected, printers, reason: "pdf-candidate" };
  }

  const defaultPrinter = printers.find((printer) => printer.isDefault);
  if (defaultPrinter && isPdfPrinter(defaultPrinter)) {
    logDebug(debug, `Selected default PDF printer: ${defaultPrinter.name}`);
    return { printer: defaultPrinter, printers, reason: "default-pdf" };
  }

  if (options.allowAnyPrinterFallback) {
    const selected = defaultPrinter || printers[0];
    logWarn(
      `No PDF-like printer was detected. Falling back to "${selected.name}" because allowAnyPrinterFallback=true.`
    );
    return { printer: selected, printers, reason: "any-printer-fallback" };
  }

  throw new Error(
    [
      "No PDF virtual printer was found in Electron's printer list.",
      `Detected printers: ${printers.map((printer) => printer.name).join(", ") || "(none)"}.`,
      "Set PDF_PRINTER_NAME or PRINTER_NAME to the exact CUPS printer name, or install/enable CUPS-PDF.",
    ].join(" ")
  );
}

function waitForDidFinishLoad(win, debug) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      win.webContents.removeListener("did-finish-load", onFinish);
      win.webContents.removeListener("did-fail-load", onFail);
      win.webContents.removeListener("render-process-gone", onGone);
    };

    const onFinish = () => {
      cleanup();
      logDebug(debug, "did-finish-load fired.");
      resolve();
    };

    const onFail = (_event, errorCode, errorDescription, validatedURL) => {
      cleanup();
      reject(
        new Error(
          `HTML load failed (${errorCode} ${errorDescription})${validatedURL ? ` for ${validatedURL}` : ""}.`
        )
      );
    };

    const onGone = (_event, details) => {
      cleanup();
      reject(new Error(`Renderer process ended while loading print HTML: ${details.reason}.`));
    };

    win.webContents.once("did-finish-load", onFinish);
    win.webContents.once("did-fail-load", onFail);
    win.webContents.once("render-process-gone", onGone);
  });
}

async function loadHTML(win, html, options = {}) {
  const debug = options.debug !== false;
  const finished = waitForDidFinishLoad(win, debug);
  const baseUrl = options.baseUrl || "file:///";
  const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(String(html || ""))}`;

  logDebug(debug, `Loading HTML content into print window (${String(html || "").length} chars).`);
  await Promise.all([finished, win.loadURL(dataUrl, { baseURLForDataURL: baseUrl })]);
}

async function waitForPageAssets(win, options = {}) {
  const debug = options.debug !== false;
  const timeoutMs = Number(options.assetWaitTimeoutMs) || DEFAULT_ASSET_WAIT_TIMEOUT_MS;
  const script = `
    (async () => {
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready.catch(() => undefined);
      }

      const images = Array.from(document.images || []);
      const pending = images.filter((image) => !image.complete);

      await Promise.all(pending.map((image) => new Promise((resolve) => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", resolve, { once: true });
      })));

      return { imageCount: images.length, waitedForImages: pending.length };
    })();
  `;

  try {
    const result = await Promise.race([
      win.webContents.executeJavaScript(script, true),
      sleep(timeoutMs).then(() => ({ timedOut: true })),
    ]);

    logDebug(debug, "Page asset readiness:", JSON.stringify(result));
  } catch (error) {
    logWarn(`Could not verify page asset readiness before printing: ${error.message}`);
  }
}

function printWebContents(webContents, printOptions, timeoutMs, debug) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for Electron print callback.`));
    }, timeoutMs);

    logDebug(debug, "Calling webContents.print() with options:", JSON.stringify(printOptions, null, 2));

    webContents.print(printOptions, (success, failureReason) => {
      if (settled) return;

      settled = true;
      clearTimeout(timeout);

      if (success) {
        logDebug(debug, "Electron reported print job submitted successfully.");
        resolve();
        return;
      }

      reject(new Error(`Electron print failed: ${failureReason || "unknown failure reason"}`));
    });
  });
}

async function listPdfFiles(outputDir) {
  try {
    const entries = await fsp.readdir(outputDir, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".pdf"))
        .map(async (entry) => {
          const fullPath = path.join(outputDir, entry.name);
          const stats = await fsp.stat(fullPath);
          return {
            path: fullPath,
            name: entry.name,
            mtimeMs: stats.mtimeMs,
            size: stats.size,
          };
        })
    );

    return files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function waitForGeneratedPdf(outputDir, beforeFiles, options = {}) {
  const debug = options.debug !== false;
  const timeoutMs = options.pdfWaitTimeoutMs || DEFAULT_PDF_WAIT_TIMEOUT_MS;
  const startedAt = Date.now();
  const beforeByPath = new Map(beforeFiles.map((file) => [file.path, file]));

  while (Date.now() - startedAt < timeoutMs) {
    const currentFiles = await listPdfFiles(outputDir);
    const createdOrChanged = currentFiles.find((file) => {
      const previous = beforeByPath.get(file.path);
      return !previous || file.mtimeMs > previous.mtimeMs || file.size !== previous.size;
    });

    if (createdOrChanged && createdOrChanged.size > 0) {
      logDebug(debug, `PDF generated: ${createdOrChanged.path} (${createdOrChanged.size} bytes).`);
      return createdOrChanged.path;
    }

    await sleep(500);
  }

  throw new Error(
    `Print job was submitted, but no new PDF appeared in ${outputDir} within ${timeoutMs}ms. Check CUPS-PDF output settings, printer permissions, and lpstat queue output.`
  );
}

function buildPrintOptions(printerName, options = {}) {
  const copies = Math.max(Number(options.copies) || 1, 1);
  const printOptions = {
    silent: true,
    printBackground: options.printBackground !== false,
    deviceName: printerName,
    copies,
  };

  if (options.pageSize) printOptions.pageSize = options.pageSize;
  if (options.landscape !== undefined) printOptions.landscape = Boolean(options.landscape);
  if (options.color !== undefined) printOptions.color = Boolean(options.color);
  if (options.duplexMode) printOptions.duplexMode = options.duplexMode;
  if (options.dpi) printOptions.dpi = options.dpi;
  if (options.margins) printOptions.margins = options.margins;
  if (options.scaleFactor) printOptions.scaleFactor = options.scaleFactor;
  if (options.pagesPerSheet) printOptions.pagesPerSheet = options.pagesPerSheet;
  if (options.collate !== undefined) printOptions.collate = Boolean(options.collate);

  return printOptions;
}

async function printHTML(html, options = {}) {
  const { app, BrowserWindow } = getElectron();
  await ensureAppReady(app);

  const debug = options.debug !== false;
  const outputDir = path.resolve(options.outputDir || process.env.PDF_OUTPUT_DIR || DEFAULT_PDF_DIR);
  const printDelayMs = Number(options.printDelayMs) || DEFAULT_PRINT_DELAY_MS;
  const printTimeoutMs = Number(options.printTimeoutMs) || DEFAULT_PRINT_TIMEOUT_MS;
  const queueSettleMs = Number(options.queueSettleMs) || DEFAULT_QUEUE_SETTLE_MS;

  await fsp.mkdir(outputDir, { recursive: true });

  let win;

  try {
    win = new BrowserWindow({
      show: Boolean(options.showWindow),
      width: options.width || 1024,
      height: options.height || 1440,
      backgroundColor: "#ffffff",
      autoHideMenuBar: true,
      paintWhenInitiallyHidden: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        images: true,
        backgroundThrottling: false,
      },
    });

    win.on("unresponsive", () => logWarn("Print BrowserWindow became unresponsive."));
    win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
      logDebug(debug, `page console[${level}] ${sourceId}:${line}`, message);
    });

    await loadHTML(win, html, options);
    await waitForPageAssets(win, options);

    const { printer, printers, reason } = await detectPrinters(win.webContents, options);
    const printerName = printer.name;

    if (!printerName) {
      throw new Error("Selected printer is missing its system device name.");
    }

    logDebug(debug, `Using CUPS deviceName "${printerName}" (${reason}).`);
    logDebug(debug, `Expected PDF output directory: ${outputDir}`);
    await logCupsState(printerName, debug);

    const beforeFiles = await listPdfFiles(outputDir);
    logDebug(debug, `PDF files before print: ${beforeFiles.length}`);

    if (options.showWindow) win.focus();

    logDebug(debug, `Waiting ${printDelayMs}ms before silent printing to let Linux rendering settle.`);
    await sleep(printDelayMs);

    const printOptions = buildPrintOptions(printerName, options);
    await printWebContents(win.webContents, printOptions, printTimeoutMs, debug);

    logDebug(debug, `Waiting ${queueSettleMs}ms before checking CUPS queue and PDF output.`);
    await sleep(queueSettleMs);
    await logCupsState(printerName, debug);

    const pdfPath = await waitForGeneratedPdf(outputDir, beforeFiles, {
      debug,
      pdfWaitTimeoutMs: options.pdfWaitTimeoutMs,
    });

    return {
      success: true,
      printerName,
      pdfPath,
      outputDir,
      printers,
    };
  } catch (error) {
    logWarn("Silent print troubleshooting:");
    logWarn("- Verify the exact CUPS printer name with `lpstat -v` or set PDF_PRINTER_NAME.");
    logWarn("- Verify CUPS is running on localhost:631 with `lpstat -r`.");
    logWarn("- Verify the CUPS-PDF output directory is ~/PDF or set PDF_OUTPUT_DIR.");
    logWarn("- If Electron sees printers but silent print fails, try showWindow=true once to expose renderer issues.");
    logWarn(error.message);
    throw error;
  } finally {
    if (win && !win.isDestroyed()) {
      logDebug(debug, "Closing print BrowserWindow.");
      win.close();
    }
  }
}

async function downloadAndPrint(jobOrUrl, token) {
  const job =
    typeof jobOrUrl === "string"
      ? { file_url: jobOrUrl, token }
      : jobOrUrl;

  if (!job?.file_path && !job?.file_url) {
    throw new Error("Print job is missing file_path or file_url.");
  }

  const destination = path.join(os.tmpdir(), safeFileName(job));

  try {
    if (job.file_path) {
      console.log(`[printer] Downloading Supabase storage file "${job.file_path}" from bucket "${STORAGE_BUCKET}".`);
      await downloadFromStorage(job.file_path, destination);
    } else {
      console.log(`[printer] Downloading print file from URL "${job.file_url}".`);
      await downloadFromUrl(job.file_url, destination);
    }

    const args = buildPrintArgs(destination, job);
    console.log(`[printer] Sending file to CUPS with lp ${args.map((arg) => JSON.stringify(arg)).join(" ")}.`);
    const { stdout, stderr } = await runLp(args);

    if (stdout) console.log(stdout.trim());
    if (stderr) console.warn(stderr.trim());

    console.log(`Printed job ${job.id || job.customer_token || job.token || destination}`);
  } finally {
    await fsp.rm(destination, { force: true });
  }
}

module.exports = downloadAndPrint;
module.exports.downloadAndPrint = downloadAndPrint;
module.exports.printHTML = printHTML;
module.exports.detectPrinters = detectPrinters;
module.exports.logCupsState = logCupsState;
