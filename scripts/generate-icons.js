const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const iconDir = path.join(__dirname, "..", "assets", "icons");
const icoPath = path.join(__dirname, "..", "assets", "icon.ico");
const sizes = [16, 32, 48, 64, 128, 256, 512];
const icoSizes = [16, 32, 48, 64, 128, 256];

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);

  length.writeUInt32BE(data.length, 0);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);

  return Buffer.concat([length, typeBuffer, data, crc]);
}

function png(width, height, pixels) {
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    rows[rowStart] = 0;
    pixels.copy(rows, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    header,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function color(hex, alpha = 255) {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
    alpha,
  ];
}

function drawIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const blue = color("#155eef");
  const light = color("#d9e8ff");
  const white = color("#ffffff");

  function blendPixel(x, y, rgba) {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const offset = (Math.floor(y) * size + Math.floor(x)) * 4;
    pixels[offset] = rgba[0];
    pixels[offset + 1] = rgba[1];
    pixels[offset + 2] = rgba[2];
    pixels[offset + 3] = rgba[3];
  }

  function rect(x, y, width, height, rgba) {
    const left = Math.round(x * size);
    const top = Math.round(y * size);
    const right = Math.round((x + width) * size);
    const bottom = Math.round((y + height) * size);

    for (let yy = top; yy < bottom; yy += 1) {
      for (let xx = left; xx < right; xx += 1) {
        blendPixel(xx, yy, rgba);
      }
    }
  }

  function roundedRect(x, y, width, height, radius, rgba) {
    const left = Math.round(x * size);
    const top = Math.round(y * size);
    const right = Math.round((x + width) * size);
    const bottom = Math.round((y + height) * size);
    const r = radius * size;

    for (let yy = top; yy < bottom; yy += 1) {
      for (let xx = left; xx < right; xx += 1) {
        const px = Math.max(left + r - xx, 0, xx - (right - r));
        const py = Math.max(top + r - yy, 0, yy - (bottom - r));
        if (px * px + py * py <= r * r) {
          blendPixel(xx, yy, rgba);
        }
      }
    }
  }

  function circle(cx, cy, radius, rgba, strokeWidth = 0) {
    const centerX = cx * size;
    const centerY = cy * size;
    const outer = radius * size;
    const inner = Math.max(outer - strokeWidth * size, 0);

    for (let yy = Math.floor(centerY - outer); yy <= Math.ceil(centerY + outer); yy += 1) {
      for (let xx = Math.floor(centerX - outer); xx <= Math.ceil(centerX + outer); xx += 1) {
        const distance = Math.hypot(xx - centerX, yy - centerY);
        if (distance <= outer && distance >= inner) {
          blendPixel(xx, yy, rgba);
        }
      }
    }
  }

  function line(x1, y1, x2, y2, width, rgba) {
    const startX = x1 * size;
    const startY = y1 * size;
    const endX = x2 * size;
    const endY = y2 * size;
    const radius = (width * size) / 2;
    const minX = Math.floor(Math.min(startX, endX) - radius);
    const maxX = Math.ceil(Math.max(startX, endX) + radius);
    const minY = Math.floor(Math.min(startY, endY) - radius);
    const maxY = Math.ceil(Math.max(startY, endY) + radius);
    const lengthSquared = (endX - startX) ** 2 + (endY - startY) ** 2;

    for (let yy = minY; yy <= maxY; yy += 1) {
      for (let xx = minX; xx <= maxX; xx += 1) {
        const t = Math.max(
          0,
          Math.min(1, ((xx - startX) * (endX - startX) + (yy - startY) * (endY - startY)) / lengthSquared),
        );
        const pointX = startX + t * (endX - startX);
        const pointY = startY + t * (endY - startY);
        if (Math.hypot(xx - pointX, yy - pointY) <= radius) {
          blendPixel(xx, yy, rgba);
        }
      }
    }
  }

  roundedRect(0, 0, 1, 1, 0.19, blue);
  roundedRect(0.26, 0.23, 0.48, 0.24, 0.03, light);
  roundedRect(0.21, 0.38, 0.58, 0.36, 0.055, white);
  roundedRect(0.29, 0.56, 0.42, 0.22, 0.025, light);
  circle(0.67, 0.49, 0.035, blue);
  circle(0.48, 0.66, 0.085, blue, 0.055);
  line(0.545, 0.725, 0.63, 0.81, 0.055, blue);

  return pixels;
}

fs.mkdirSync(iconDir, { recursive: true });

const icoImages = [];

for (const size of sizes) {
  const image = png(size, size, drawIcon(size));
  fs.writeFileSync(path.join(iconDir, `${size}x${size}.png`), image);

  if (icoSizes.includes(size)) {
    icoImages.push({ size, image });
  }
}

function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const directorySize = header.length + images.length * 16;
  let imageOffset = directorySize;
  const entries = [];

  for (const { size, image } of images) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.length, 8);
    entry.writeUInt32LE(imageOffset, 12);
    entries.push(entry);
    imageOffset += image.length;
  }

  return Buffer.concat([
    header,
    ...entries,
    ...images.map(({ image }) => image),
  ]);
}

fs.writeFileSync(icoPath, ico(icoImages));
