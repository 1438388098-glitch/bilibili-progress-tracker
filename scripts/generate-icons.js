const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function createPNG(size, r, g, b) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4);
  ihdr.writeUInt32BE(size, 8);
  ihdr.writeUInt32BE(size, 12);
  ihdr[16] = 8;
  ihdr[17] = 2;
  ihdr[18] = 0;
  ihdr[19] = 0;
  ihdr[20] = 0;
  const crc32 = new CRC32();
  crc32.update(ihdr.slice(4, 21));
  ihdr.writeUInt32BE(crc32.finalize(), 21);

  const rawData = Buffer.alloc(size * 4 * size + size);
  for (let y = 0; y < size; y++) {
    rawData[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const cx = x / size, cy = y / size;
      const dist = Math.sqrt((cx - 0.5) ** 2 + (cy - 0.5) ** 2);
      const alpha = dist < 0.45 ? 255 : 0;
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      rawData[offset] = r;
      rawData[offset + 1] = g;
      rawData[offset + 2] = b;
      rawData[offset + 3] = alpha;
    }
  }

  const compressed = zlib.deflateSync(rawData);
  const idat = Buffer.alloc(compressed.length + 12);
  idat.writeUInt32BE(compressed.length, 0);
  idat.write('IDAT', 4);
  compressed.copy(idat, 8);
  const crc32b = new CRC32();
  crc32b.update(idat.slice(4, 8 + compressed.length));
  idat.writeUInt32BE(crc32b.finalize(), 8 + compressed.length);

  const iend = Buffer.alloc(12);
  iend.writeUInt32BE(0, 0);
  iend.write('IEND', 4);
  const crc32c = new CRC32();
  crc32c.update(iend.slice(4, 8));
  iend.writeUInt32BE(crc32c.finalize(), 8);

  return Buffer.concat([signature, ihdr, idat, iend]);
}

class CRC32 {
  constructor() {
    this.crc = 0xFFFFFFFF;
  }
  update(buf) {
    for (let i = 0; i < buf.length; i++) {
      this.crc ^= buf[i];
      for (let j = 0; j < 8; j++) {
        if (this.crc & 1) this.crc = (this.crc >>> 1) ^ 0xEDB88320;
        else this.crc >>>= 1;
      }
    }
  }
  finalize() {
    return (this.crc ^ 0xFFFFFFFF) >>> 0;
  }
}

const iconsDir = path.join(__dirname, '..', 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

[16, 48, 128].forEach(size => {
  const png = createPNG(size, 0, 161, 214);
  fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), png);
  console.log(`Created icon${size}.png`);
});

console.log('Done!');
