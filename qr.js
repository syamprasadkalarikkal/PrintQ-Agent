const crypto = require("node:crypto");
const https = require("node:https");

const QR_VALIDITY_SECONDS = 5 * 60;
const QR_REFRESH_SECONDS = 4 * 60 + 45;
const MAX_CLOCK_DRIFT_MS = 30 * 1000;

function base64Url(buffer) {
  return buffer
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function isLocalhost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function getQrConfig(env = process.env) {
  const missing = [];
  const publicWebsiteUrl = env.PUBLIC_WEBSITE_URL;
  const shopId = env.SHOP_ID || "main-counter";
  const qrAccessSecret = env.QR_ACCESS_SECRET;

  if (!publicWebsiteUrl) missing.push("PUBLIC_WEBSITE_URL");
  if (!qrAccessSecret) missing.push("QR_ACCESS_SECRET");

  if (missing.length > 0) {
    return {
      ok: false,
      error: `Missing required config: ${missing.join(", ")}`,
    };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(publicWebsiteUrl);
  } catch {
    return {
      ok: false,
      error: "PUBLIC_WEBSITE_URL must be a valid URL.",
    };
  }

  if (parsedUrl.protocol !== "https:" && !isLocalhost(parsedUrl.hostname)) {
    return {
      ok: false,
      error: "PUBLIC_WEBSITE_URL must use HTTPS. Only localhost is allowed for development.",
    };
  }

  return {
    ok: true,
    publicWebsiteUrl,
    shopId,
    qrAccessSecret,
    isLocalDevelopment: parsedUrl.protocol !== "https:" && isLocalhost(parsedUrl.hostname),
  };
}

function createQrUploadUrl(config, now = Date.now()) {
  const expires = Math.floor(now / 1000) + QR_VALIDITY_SECONDS;
  const nonce = crypto.randomBytes(16).toString("base64url");
  const payload = `${config.shopId}.${expires}.${nonce}`;
  const qrSig = base64Url(
    crypto.createHmac("sha256", config.qrAccessSecret).update(payload).digest()
  );

  const url = new URL(config.publicWebsiteUrl);
  url.searchParams.set("shop", config.shopId);
  url.searchParams.set("qr_expires", String(expires));
  url.searchParams.set("qr_nonce", nonce);
  url.searchParams.set("qr_sig", qrSig);
  return {
    expires,
    url: url.toString(),
  };
}

function checkInternetClock(clockUrl = process.env.CLOCK_CHECK_URL || "https://www.google.com/generate_204") {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const request = https.request(clockUrl, { method: "HEAD", timeout: 5000 }, (response) => {
      const dateHeader = response.headers.date;
      response.resume();

      if (!dateHeader) {
        resolve({
          ok: false,
          message: "Internet clock check did not return a Date header.",
        });
        return;
      }

      const serverTime = Date.parse(dateHeader);
      if (Number.isNaN(serverTime)) {
        resolve({
          ok: false,
          message: "Internet clock check returned an invalid Date header.",
        });
        return;
      }

      const roundTripEstimate = Math.max(0, Date.now() - startedAt) / 2;
      const localTime = Date.now() - roundTripEstimate;
      const driftMs = Math.round(localTime - serverTime);
      const absoluteDriftMs = Math.abs(driftMs);

      resolve({
        ok: absoluteDriftMs <= MAX_CLOCK_DRIFT_MS,
        driftMs,
        message:
          absoluteDriftMs <= MAX_CLOCK_DRIFT_MS
            ? "Clock check OK"
            : "Computer clock may be out of sync. Enable internet time sync before using deployed QR codes.",
      });
    });

    request.on("timeout", () => {
      request.destroy();
      resolve({
        ok: false,
        message: "Internet clock check timed out.",
      });
    });

    request.on("error", () => {
      resolve({
        ok: false,
        message: "Internet clock check unavailable.",
      });
    });

    request.end();
  });
}

module.exports = {
  QR_REFRESH_SECONDS,
  QR_VALIDITY_SECONDS,
  checkInternetClock,
  createQrUploadUrl,
  getQrConfig,
};
