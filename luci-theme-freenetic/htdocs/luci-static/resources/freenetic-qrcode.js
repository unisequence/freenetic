'use strict';
'require baseclass';

/* Minimal QR code encoder: byte mode only, fixed mask pattern 0, versions 1-10,
   EC level M with fallback to L for longer payloads. No external services.
   Mask 0 is always used instead of scoring for the "best" mask — any valid
   mask is correct and scannable, optimal selection only improves margin. */

const EXP_TABLE = new Array(512);
const LOG_TABLE = new Array(256);

(function initGF256() {
	let g = 1;
	for (let i = 0; i < 255; i++) {
		EXP_TABLE[i] = g;
		LOG_TABLE[g] = i;
		g <<= 1;
		if (g & 0x100)
			g ^= 0x11d;
	}
	for (let i = 255; i < 512; i++)
		EXP_TABLE[i] = EXP_TABLE[i - 255];
})();

function gmul(a, b) {
	if (a === 0 || b === 0)
		return 0;
	return EXP_TABLE[LOG_TABLE[a] + LOG_TABLE[b]];
}

function generatorPolynomial(ecCount) {
	let poly = [ 1 ];
	for (let i = 0; i < ecCount; i++) {
		const next = new Array(poly.length + 1).fill(0);
		for (let j = 0; j < poly.length; j++) {
			next[j] ^= gmul(poly[j], 1);
			next[j + 1] ^= gmul(poly[j], EXP_TABLE[i]);
		}
		poly = next;
	}
	return poly;
}

function rsEncode(dataBytes, ecCount) {
	const gen = generatorPolynomial(ecCount);
	const msg = dataBytes.concat(new Array(ecCount).fill(0));

	for (let i = 0; i < dataBytes.length; i++) {
		const coef = msg[i];
		if (coef === 0)
			continue;
		for (let j = 0; j < gen.length; j++)
			msg[i + j] ^= gmul(coef, gen[j]);
	}

	return msg.slice(dataBytes.length);
}

// [blockCount, totalCodewordsPerBlock, dataCodewordsPerBlock], versions 1-10 only
const RS_BLOCKS = {
	L: [
		[ [ 1, 26, 19 ] ],
		[ [ 1, 44, 34 ] ],
		[ [ 1, 70, 55 ] ],
		[ [ 1, 100, 80 ] ],
		[ [ 1, 134, 108 ] ],
		[ [ 2, 86, 68 ] ],
		[ [ 2, 98, 78 ] ],
		[ [ 2, 121, 97 ] ],
		[ [ 2, 146, 116 ] ],
		[ [ 2, 86, 68 ], [ 2, 87, 69 ] ]
	],
	M: [
		[ [ 1, 26, 16 ] ],
		[ [ 1, 44, 28 ] ],
		[ [ 1, 70, 44 ] ],
		[ [ 2, 50, 32 ] ],
		[ [ 2, 67, 43 ] ],
		[ [ 4, 43, 27 ] ],
		[ [ 4, 49, 31 ] ],
		[ [ 2, 60, 38 ], [ 2, 61, 39 ] ],
		[ [ 3, 58, 36 ], [ 2, 59, 37 ] ],
		[ [ 4, 69, 43 ], [ 1, 70, 44 ] ]
	]
};

const ALIGNMENT_POSITIONS = {
	2: [ 6, 18 ], 3: [ 6, 22 ], 4: [ 6, 26 ], 5: [ 6, 30 ], 6: [ 6, 34 ],
	7: [ 6, 22, 38 ], 8: [ 6, 24, 42 ], 9: [ 6, 26, 46 ], 10: [ 6, 28, 50 ]
};

// format-info EC-level field values per ISO 18004 (spec order is not 0=L,1=M)
const EC_LEVEL_BITS = { L: 1, M: 0 };

const G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
const G18 = (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0);
const G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);

function bchDigitCount(n) {
	let bits = 0;
	while (n !== 0) {
		bits++;
		n >>>= 1;
	}
	return bits;
}

function bchEncode(data, generator) {
	let d = data << (bchDigitCount(generator) - 1);
	while (bchDigitCount(d) >= bchDigitCount(generator))
		d ^= generator << (bchDigitCount(d) - bchDigitCount(generator));
	return d;
}

function formatBits(ecLevel, maskPattern) {
	const data = (EC_LEVEL_BITS[ecLevel] << 3) | maskPattern;
	return ((data << 10) | bchEncode(data, G15)) ^ G15_MASK;
}

function versionBits(version) {
	return (version << 12) | bchEncode(version, G18);
}

class BitBuffer {
	constructor() {
		this.bytes = [];
		this.length = 0;
	}

	put(num, len) {
		for (let i = 0; i < len; i++)
			this.putBit(((num >>> (len - i - 1)) & 1) === 1);
	}

	putBit(bit) {
		const idx = this.length >>> 3;
		if (this.bytes.length <= idx)
			this.bytes.push(0);
		if (bit)
			this.bytes[idx] |= (0x80 >>> (this.length % 8));
		this.length++;
	}
}

function utf8Bytes(str) {
	const bytes = [];
	for (const ch of unescape(encodeURIComponent(str)))
		bytes.push(ch.charCodeAt(0));
	return bytes;
}

function capacityBytes(version, ecLevel) {
	return RS_BLOCKS[ecLevel][version - 1].reduce((sum, [ count, , data ]) => sum + count * data, 0);
}

function pickVersion(byteLength) {
	for (const ecLevel of [ 'M', 'L' ]) {
		for (let version = 1; version <= 10; version++) {
			const countBits = version <= 9 ? 8 : 16;
			const headerBits = 4 + countBits;
			const capBits = capacityBytes(version, ecLevel) * 8;
			if (headerBits + 8 * byteLength + 4 <= capBits)
				return { version, ecLevel };
		}
	}
	return null;
}

function buildDataCodewords(bytes, version, ecLevel) {
	const buf = new BitBuffer();
	const countBits = version <= 9 ? 8 : 16;

	buf.put(4, 4);
	buf.put(bytes.length, countBits);
	for (const b of bytes)
		buf.put(b, 8);

	const capBytes = capacityBytes(version, ecLevel);
	const capBits = capBytes * 8;

	if (buf.length + 4 <= capBits)
		buf.put(0, 4);
	while (buf.length % 8 !== 0)
		buf.putBit(false);

	const pad = [ 0xec, 0x11 ];
	let i = 0;
	while (buf.bytes.length < capBytes) {
		buf.put(pad[i % 2], 8);
		i++;
	}

	return buf.bytes;
}

function interleave(dataBlocks, ecBlocks) {
	const result = [];
	const maxData = Math.max(...dataBlocks.map(b => b.length));
	for (let i = 0; i < maxData; i++)
		for (const block of dataBlocks)
			if (i < block.length)
				result.push(block[i]);

	const maxEc = Math.max(...ecBlocks.map(b => b.length));
	for (let i = 0; i < maxEc; i++)
		for (const block of ecBlocks)
			if (i < block.length)
				result.push(block[i]);

	return result;
}

function buildMatrix(version, ecLevel, codewords) {
	const moduleCount = version * 4 + 17;
	const matrix = Array.from({ length: moduleCount }, () => new Array(moduleCount).fill(null));
	const reserved = Array.from({ length: moduleCount }, () => new Array(moduleCount).fill(false));

	function placeFinder(row, col) {
		for (let r = -1; r <= 7; r++) {
			for (let c = -1; c <= 7; c++) {
				const rr = row + r, cc = col + c;
				if (rr <= -1 || moduleCount <= rr || cc <= -1 || moduleCount <= cc)
					continue;
				const dark = (0 <= r && r <= 6 && (c === 0 || c === 6)) ||
					(0 <= c && c <= 6 && (r === 0 || r === 6)) ||
					(2 <= r && r <= 4 && 2 <= c && c <= 4);
				matrix[rr][cc] = dark;
				reserved[rr][cc] = true;
			}
		}
	}

	placeFinder(0, 0);
	placeFinder(0, moduleCount - 7);
	placeFinder(moduleCount - 7, 0);

	/* must place alignment patterns before timing patterns — for version >= 7 some
	   alignment centers sit on the timing row/column and would get skipped otherwise */
	const positions = ALIGNMENT_POSITIONS[version];
	if (positions) {
		for (const row of positions) {
			for (const col of positions) {
				if (matrix[row][col] !== null)
					continue;
				for (let r = -2; r <= 2; r++) {
					for (let c = -2; c <= 2; c++) {
						const dark = (r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0));
						matrix[row + r][col + c] = dark;
						reserved[row + r][col + c] = true;
					}
				}
			}
		}
	}

	for (let r = 8; r < moduleCount - 8; r++) {
		if (matrix[r][6] !== null)
			continue;
		matrix[r][6] = (r % 2 === 0);
		reserved[r][6] = true;
	}
	for (let c = 8; c < moduleCount - 8; c++) {
		if (matrix[6][c] !== null)
			continue;
		matrix[6][c] = (c % 2 === 0);
		reserved[6][c] = true;
	}

	matrix[moduleCount - 8][8] = true;
	reserved[moduleCount - 8][8] = true;

	const fBits = formatBits(ecLevel, 0);
	for (let i = 0; i < 15; i++) {
		const mod = ((fBits >> i) & 1) === 1;
		if (i < 6) {
			matrix[i][8] = mod;
			reserved[i][8] = true;
		} else if (i < 8) {
			matrix[i + 1][8] = mod;
			reserved[i + 1][8] = true;
		} else {
			matrix[moduleCount - 15 + i][8] = mod;
			reserved[moduleCount - 15 + i][8] = true;
		}
	}
	for (let i = 0; i < 15; i++) {
		const mod = ((fBits >> i) & 1) === 1;
		if (i < 8) {
			matrix[8][moduleCount - i - 1] = mod;
			reserved[8][moduleCount - i - 1] = true;
		} else if (i < 9) {
			matrix[8][15 - i - 1 + 1] = mod;
			reserved[8][15 - i - 1 + 1] = true;
		} else {
			matrix[8][15 - i - 1] = mod;
			reserved[8][15 - i - 1] = true;
		}
	}

	if (version >= 7) {
		const vBits = versionBits(version);
		for (let i = 0; i < 18; i++) {
			const mod = ((vBits >> i) & 1) === 1;
			const r = Math.floor(i / 3), c = (i % 3) + moduleCount - 8 - 3;
			matrix[r][c] = mod;
			reserved[r][c] = true;
			matrix[c][r] = mod;
			reserved[c][r] = true;
		}
	}

	let inc = -1, row = moduleCount - 1, bitIndex = 7, byteIndex = 0;
	for (let col = moduleCount - 1; col > 0; col -= 2) {
		if (col === 6)
			col--;
		for (;;) {
			for (let c = 0; c < 2; c++) {
				const cc = col - c;
				if (!reserved[row][cc]) {
					let dark = byteIndex < codewords.length && ((codewords[byteIndex] >>> bitIndex) & 1) === 1;
					if ((row + cc) % 2 === 0)
						dark = !dark;
					matrix[row][cc] = dark;
					bitIndex--;
					if (bitIndex === -1) {
						byteIndex++;
						bitIndex = 7;
					}
				}
			}
			row += inc;
			if (row < 0 || moduleCount <= row) {
				row -= inc;
				inc = -inc;
				break;
			}
		}
	}

	return matrix;
}

return baseclass.extend({
	/* Returns a 2D boolean matrix, or null if the text is too long to
	   fit in any of the supported versions (1-10). */
	encode(text) {
		const bytes = utf8Bytes(text);
		const picked = pickVersion(bytes.length);
		if (!picked)
			return null;

		const { version, ecLevel } = picked;
		const dataCodewords = buildDataCodewords(bytes, version, ecLevel);

		const groups = RS_BLOCKS[ecLevel][version - 1];
		const dataBlocks = [], ecBlocks = [];
		let offset = 0;
		for (const [ count, totalLen, dataLen ] of groups) {
			const ecCount = totalLen - dataLen;
			for (let i = 0; i < count; i++) {
				const block = dataCodewords.slice(offset, offset + dataLen);
				offset += dataLen;
				dataBlocks.push(block);
				ecBlocks.push(rsEncode(block, ecCount));
			}
		}

		return buildMatrix(version, ecLevel, interleave(dataBlocks, ecBlocks));
	},

	renderToCanvas(canvas, text, cellSize) {
		const matrix = this.encode(text);
		if (!matrix)
			return false;

		cellSize = cellSize || 6;
		const quiet = 4;
		const size = matrix.length + quiet * 2;

		canvas.width = size * cellSize;
		canvas.height = size * cellSize;

		const ctx = canvas.getContext('2d');
		ctx.fillStyle = '#fff';
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.fillStyle = '#000';

		for (let r = 0; r < matrix.length; r++)
			for (let c = 0; c < matrix.length; c++)
				if (matrix[r][c])
					ctx.fillRect((c + quiet) * cellSize, (r + quiet) * cellSize, cellSize, cellSize);

		return true;
	}
});
