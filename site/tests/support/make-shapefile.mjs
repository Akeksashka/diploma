// Writes a tiny SYNTHETIC polygon shapefile (.shp) and dBASE table (.dbf) in memory for the prepare-geo tests.
// Rings are given in shapefile order: exterior clockwise, holes counter-clockwise. Invented data.
export function makeShp(records) {
  const bodies = records.map((rings) => {
    if (!rings.length) {
      const b = Buffer.alloc(4);
      b.writeInt32LE(0, 0);
      return b;
    }
    const pts = rings.flat();
    const b = Buffer.alloc(44 + rings.length * 4 + pts.length * 16);
    b.writeInt32LE(5, 0);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].forEach((v, i) => b.writeDoubleLE(v, 4 + i * 8));
    b.writeInt32LE(rings.length, 36);
    b.writeInt32LE(pts.length, 40);
    let k = 0;
    rings.forEach((r, i) => {
      b.writeInt32LE(k, 44 + i * 4);
      k += r.length;
    });
    pts.forEach((p, i) => {
      b.writeDoubleLE(p[0], 44 + rings.length * 4 + i * 16);
      b.writeDoubleLE(p[1], 52 + rings.length * 4 + i * 16);
    });
    return b;
  });
  const total = 100 + bodies.reduce((n, b) => n + 8 + b.length, 0);
  const out = Buffer.alloc(total);
  out.writeInt32BE(9994, 0);
  out.writeInt32BE(total / 2, 24);
  out.writeInt32LE(1000, 28);
  out.writeInt32LE(5, 32);
  let o = 100;
  bodies.forEach((b, i) => {
    out.writeInt32BE(i + 1, o);
    out.writeInt32BE(b.length / 2, o + 4);
    b.copy(out, o + 8);
    o += 8 + b.length;
  });
  return out;
}

export function makeDbf(rows, fields) {
  const recLen = 1 + fields.reduce((n, f) => n + f.len, 0);
  const headerLen = 32 + fields.length * 32 + 1;
  const out = Buffer.alloc(headerLen + rows.length * recLen, 0x20);
  out.writeUInt8(3, 0);
  out.writeUInt32LE(rows.length, 4);
  out.writeUInt16LE(headerLen, 8);
  out.writeUInt16LE(recLen, 10);
  fields.forEach((f, i) => {
    const o = 32 + i * 32;
    out.fill(0, o, o + 32);
    out.write(f.name, o, "latin1");
    out.write("C", o + 11, "latin1");
    out.writeUInt8(f.len, o + 16);
  });
  out.writeUInt8(0x0d, 32 + fields.length * 32);
  rows.forEach((row, r) => {
    let p = headerLen + r * recLen + 1;
    for (const f of fields) {
      out.fill(0, p, p + f.len);
      out.write(String(row[f.name] ?? ""), p, "utf8");
      p += f.len;
    }
  });
  return out;
}

/** Clockwise square ring (shapefile exterior) with its lower-left corner at (x, y) and side s. */
export const cw = (x, y, s) => [[x, y], [x, y + s], [x + s, y + s], [x + s, y], [x, y]];
/** Counter-clockwise ring (hole). */
export const ccw = (x, y, s) => cw(x, y, s).reverse();
