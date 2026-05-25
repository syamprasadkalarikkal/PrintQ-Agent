const { spawn } = require("child_process");
const electronPath = require("electron");

const env = { ...process.env };
const args = process.argv.slice(2);

delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_NO_ATTACH_CONSOLE;

if (env.XDG_DATA_DIRS_VSCODE_SNAP_ORIG) {
  env.XDG_DATA_DIRS = env.XDG_DATA_DIRS_VSCODE_SNAP_ORIG;
}

if (env.XDG_CONFIG_DIRS_VSCODE_SNAP_ORIG) {
  env.XDG_CONFIG_DIRS = env.XDG_CONFIG_DIRS_VSCODE_SNAP_ORIG;
}

for (const key of [
  "GDK_PIXBUF_MODULE_FILE",
  "GDK_PIXBUF_MODULEDIR",
  "GTK_EXE_PREFIX",
  "GTK_IM_MODULE_FILE",
  "GTK_PATH",
]) {
  if (String(env[key] || "").includes("/snap/code/")) {
    delete env[key];
  }
}

const hasOzonePlatform = args.some(
  (arg) => arg === "--ozone-platform" || arg.startsWith("--ozone-platform=")
);

if (process.platform === "linux" && !hasOzonePlatform) {
  args.unshift("--ozone-platform=x11");
}

if (process.platform === "linux" && !args.includes("--no-sandbox")) {
  args.unshift("--no-sandbox");
}

const child = spawn(electronPath, args, {
  env,
  stdio: "inherit",
  windowsHide: false,
});

child.on("close", (code, signal) => {
  if (signal) {
    console.error(`${electronPath} exited with signal ${signal}`);
    process.exit(1);
  }

  process.exit(code ?? 0);
});
