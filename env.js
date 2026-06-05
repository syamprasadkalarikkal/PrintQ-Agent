const fs = require("fs");
const path = require("path");

function loadEnvFile(envPath = null) {
  // If a specific path is passed and exists, use it
  if (envPath && fs.existsSync(envPath)) {
    // Proceed with this specific path
  } else {
    // Search possible locations suited for both dev and production packaged states
    const possiblePaths = [
      // 1. Next to the executable (standard for packaged Electron apps where user edits .env next to the exe)
      path.join(path.dirname(process.execPath), ".env"),
      
      // 2. In the current working directory (where the process is started)
      path.join(process.cwd(), ".env"),
      
      // 3. Inside the app directory (for development or non-packaged runs)
      path.join(__dirname, ".env"),
    ];

    if (process.resourcesPath) {
      // 4. Inside resources folder of packaged Electron app
      possiblePaths.push(path.join(process.resourcesPath, ".env"));
    }

    // Try to find the first path that actually has a .env file
    envPath = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        envPath = p;
        break;
      }
    }
  }

  // If no env file was found, we return
  if (!envPath) {
    console.warn("No .env file found in standard candidate directories.");
    return;
  }

  try {
    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) continue;

      const key = trimmed.slice(0, separatorIndex).trim();
      let value = trimmed.slice(separatorIndex + 1).trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      // Override only if not already defined or if empty (to avoid blank variables overriding values)
      if (!process.env[key] || process.env[key] === "") {
        process.env[key] = value;
      }
    }
  } catch (err) {
    console.error(`Failed to read .env file at ${envPath}:`, err.message);
  }
}

module.exports = {
  loadEnvFile,
};
