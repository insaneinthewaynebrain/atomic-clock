// Reads when and where a JPEG photo was taken from its EXIF data (on the phone; nothing is uploaded).
// Returns { taken: ms | null, lat: number | null, lon: number | null }. Any other format, or no EXIF, gives nulls.

export async function readExif(file) {
  const out = { taken: null, lat: null, lon: null };
  try {
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();      // EXIF sits at the start of the file
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xffd8) return out;                         // not a JPEG
    let p = 2;
    while (p + 4 < v.byteLength) {
      const marker = v.getUint16(p), len = v.getUint16(p + 2);
      if (marker === 0xffe1 && v.getUint32(p + 4) === 0x45786966) return parseTiff(v, p + 10, out);   // "Exif"
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;     // start of image data: no EXIF
      p += 2 + len;
    }
  } catch (e) { /* unreadable: no data */ }
  return out;
}

function parseTiff(v, t, out) {
  const le = v.getUint16(t) === 0x4949;
  const u16 = (o) => v.getUint16(t + o, le), u32 = (o) => v.getUint32(t + o, le);
  const ascii = (o, n) => { let s = ''; for (let i = 0; i < n - 1; i++) s += String.fromCharCode(v.getUint8(t + o + i)); return s; };
  const rational = (o) => u32(o) / (u32(o + 4) || 1);
  const ifd = (o) => {
    const tags = {};
    const n = u16(o);
    for (let i = 0; i < n; i++) {
      const e = o + 2 + i * 12, tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      const size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }[type] || 1;
      const at = size * count > 4 ? u32(e + 8) : e + 8;
      tags[tag] = { type, count, at };
    }
    return tags;
  };
  const root = ifd(u32(4));
  // Date taken: DateTimeOriginal (in the Exif sub-directory), else DateTime.
  let dt = null;
  if (root[0x8769]) {
    const ex = ifd(u32(root[0x8769].at));
    if (ex[0x9003]) dt = ascii(ex[0x9003].at, ex[0x9003].count);
  }
  if (!dt && root[0x0132]) dt = ascii(root[0x0132].at, root[0x0132].count);
  const m = dt && dt.match(/(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/);
  if (m) out.taken = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();   // camera's local time
  // GPS
  if (root[0x8825]) {
    const g = ifd(u32(root[0x8825].at));
    const deg = (tag) => (g[tag] ? rational(g[tag].at) + rational(g[tag].at + 8) / 60 + rational(g[tag].at + 16) / 3600 : null);
    const ref = (tag) => (g[tag] ? String.fromCharCode(v.getUint8(t + g[tag].at)) : '');
    const lat = deg(2), lon = deg(4);
    if (lat != null && lon != null && (lat || lon)) {
      out.lat = ref(1) === 'S' ? -lat : lat;
      out.lon = ref(3) === 'W' ? -lon : lon;
    }
  }
  return out;
}
