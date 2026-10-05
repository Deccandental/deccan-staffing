// A minimal ZIP writer (files stored without compression). Statement and invoice PDFs are already
// compressed, so there is nothing to gain from compressing them again, and this needs no extra package.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export class ZipBuilder {
  private chunks: Buffer[] = [];
  private central: Buffer[] = [];
  private offset = 0;
  private count = 0;

  add(name: string, data: Uint8Array) {
    const nameBuf = Buffer.from(name, "utf8");
    const body = Buffer.from(data);
    const crc = crc32(body);
    const size = body.length;
    const d = new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18); local.writeUInt32LE(size, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    this.chunks.push(local, nameBuf, body);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(0, 10);
    cen.writeUInt16LE(dosTime, 12); cen.writeUInt16LE(dosDate, 14); cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(size, 20); cen.writeUInt32LE(size, 24); cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30); cen.writeUInt16LE(0, 32); cen.writeUInt16LE(0, 34); cen.writeUInt16LE(0, 36);
    cen.writeUInt32LE(0, 38); cen.writeUInt32LE(this.offset, 42);
    this.central.push(cen, nameBuf);

    this.offset += 30 + nameBuf.length + size;
    this.count++;
  }

  build(): Buffer {
    const cd = Buffer.concat(this.central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
    end.writeUInt16LE(this.count, 8); end.writeUInt16LE(this.count, 10);
    end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(this.offset, 16); end.writeUInt16LE(0, 20);
    return Buffer.concat([...this.chunks, cd, end]);
  }
}
