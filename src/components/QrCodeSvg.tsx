import React, { useMemo } from 'react';

// Compact ISO/IEC 18004 Byte-Mode QR Encoder (Versions 2–4, ECC Level L, Mask 0)
// Zero external dependencies; works 100% offline on houseboat / mobile hotspot LANs.

interface VersionSpec {
  version: number;
  size: number;
  dataBytes: number;
  ecBytes: number;
  alignCenters: number[];
}

const SPECS: VersionSpec[] = [
  { version: 2, size: 25, dataBytes: 34, ecBytes: 10, alignCenters: [6, 18] },
  { version: 3, size: 29, dataBytes: 55, ecBytes: 15, alignCenters: [6, 22] },
  { version: 4, size: 33, dataBytes: 80, ecBytes: 20, alignCenters: [6, 26] },
];

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_EXP[i + 255] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: Uint8Array, ecLen: number): Uint8Array {
  const gen = rsGeneratorPoly(ecLen);
  const rem = new Uint8Array(ecLen);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecLen - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < ecLen; j++) {
        rem[j] ^= gfMul(gen[j + 1], factor);
      }
    }
  }
  return rem;
}

function computeFormatBits(ecLevelBits: number, mask: number): number {
  const data = (ecLevelBits << 3) | mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >> i) & 1) {
      rem ^= 0x537 << (i - 10);
    }
  }
  return ((data << 10) | rem) ^ 0x5412;
}

export function buildQrMatrix(text: string): boolean[][] {
  const utf8 = new TextEncoder().encode(text);
  const spec = SPECS.find((s) => utf8.length + 2 <= s.dataBytes) || SPECS[SPECS.length - 1];
  const payload = utf8.slice(0, spec.dataBytes - 2);

  // Bitstream: 0100 (Byte mode) + 8-bit length + bytes + 0000 terminator + pad 0xEC/0x11
  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };
  pushBits(0b0100, 4);
  pushBits(payload.length, 8);
  for (const b of payload) pushBits(b, 8);
  const maxBits = spec.dataBytes * 8;
  for (let i = 0; i < 4 && bits.length < maxBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataWords = new Uint8Array(spec.dataBytes);
  for (let i = 0; i < bits.length / 8; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | bits[i * 8 + b];
    dataWords[i] = byte;
  }
  let padToggle = true;
  for (let i = bits.length / 8; i < spec.dataBytes; i++) {
    dataWords[i] = padToggle ? 0xec : 0x11;
    padToggle = !padToggle;
  }

  const ecWords = rsEncode(dataWords, spec.ecBytes);
  const allWords = new Uint8Array(spec.dataBytes + spec.ecBytes);
  allWords.set(dataWords, 0);
  allWords.set(ecWords, spec.dataBytes);

  const n = spec.size;
  const mod: boolean[][] = Array.from({ length: n }, () => Array(n).fill(false));
  const reserved: boolean[][] = Array.from({ length: n }, () => Array(n).fill(false));

  const setModule = (r: number, c: number, val: boolean) => {
    if (r >= 0 && r < n && c >= 0 && c < n) {
      mod[r][c] = val;
      reserved[r][c] = true;
    }
  };

  const placeFinder = (r0: number, c0: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const rr = r0 + dr;
        const cc = c0 + dc;
        if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onRing = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inCore = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setModule(rr, cc, inOuter && (onRing || inCore));
      }
    }
  };

  placeFinder(0, 0);
  placeFinder(0, n - 7);
  placeFinder(n - 7, 0);

  // Alignment pattern(s)
  for (const ar of spec.alignCenters) {
    for (const ac of spec.alignCenters) {
      if (reserved[ar][ac]) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setModule(ar + dr, ac + dc, dark);
        }
      }
    }
  }

  // Timing patterns
  for (let i = 8; i < n - 8; i++) {
    if (!reserved[6][i]) setModule(6, i, i % 2 === 0);
    if (!reserved[i][6]) setModule(i, 6, i % 2 === 0);
  }

  // Dark module & reserve format info slots
  setModule(n - 8, 8, true);
  for (let i = 0; i < 9; i++) {
    if (!reserved[8][i]) reserved[8][i] = true;
    if (!reserved[i][8]) reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][n - 1 - i] = true;
    reserved[n - 1 - i][8] = true;
  }

  // Choose best mask (0..7) with lowest run/block penalty so phone cameras scan instantaneously
  const cloneBase = () => mod.map((row) => row.slice());
  const maskFn = (mask: number, r: number, c: number): boolean => {
    switch (mask) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    }
  };

  const applyCandidate = (mask: number): boolean[][] => {
    const grid = cloneBase();
    let bitIdx = 0;
    const totalDataBits = allWords.length * 8;
    let upward = true;

    for (let rightCol = n - 1; rightCol >= 1; rightCol -= 2) {
      if (rightCol === 6) rightCol = 5;
      for (let step = 0; step < n; step++) {
        const r = upward ? n - 1 - step : step;
        for (const c of [rightCol, rightCol - 1]) {
          if (reserved[r][c]) continue;
          let dark = false;
          if (bitIdx < totalDataBits) {
            dark = ((allWords[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1) === 1;
            bitIdx++;
          }
          if (maskFn(mask, r, c)) dark = !dark;
          grid[r][c] = dark;
        }
      }
      upward = !upward;
    }

    // ECC Level L = 01 in ISO/IEC 18004 format bits
    const fmt = computeFormatBits(0b01, mask);
    const fmtPositionsA: Array<[number, number]> = [
      [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
      [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
    ];
    for (let i = 0; i < 15; i++) {
      const bit = ((fmt >> (14 - i)) & 1) === 1;
      const [rA, cA] = fmtPositionsA[i];
      grid[rA][cA] = bit;
      if (i < 7) {
        grid[n - 1 - i][8] = bit;
      } else {
        grid[8][n - 15 + i] = bit;
      }
    }
    return grid;
  };

  let bestGrid = applyCandidate(0);
  let bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    const g = applyCandidate(m);
    let score = 0;
    for (let r = 0; r < n - 1; r++) {
      for (let c = 0; c < n - 1; c++) {
        const v = g[r][c];
        if (v === g[r][c + 1] && v === g[r + 1][c] && v === g[r + 1][c + 1]) score += 3;
      }
    }
    if (score < bestScore) {
      bestScore = score;
      bestGrid = g;
    }
  }

  return bestGrid;
}

export const QrCodeSvg: React.FC<{ value: string; size?: number }> = ({ value, size = 112 }) => {
  const matrix = useMemo(() => buildQrMatrix(value), [value]);
  const quiet = 3;
  const total = matrix.length + quiet * 2;

  let pathD = '';
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix.length; c++) {
      if (matrix[r][c]) {
        pathD += `M${c + quiet},${r + quiet}h1v1h-1z`;
      }
    }
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${total} ${total}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={`QR code for ${value}`}
      style={{
        background: '#ffffff',
        borderRadius: 10,
        border: '2px solid #16121c',
        flexShrink: 0,
      }}
    >
      <rect width={total} height={total} fill="#ffffff" />
      <path d={pathD} fill="#16121c" />
    </svg>
  );
};
