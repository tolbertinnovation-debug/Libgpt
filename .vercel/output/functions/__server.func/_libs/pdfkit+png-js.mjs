import { createRequire as __wkfCreateRequire } from "node:module";
if (typeof require === "undefined") globalThis.require = __wkfCreateRequire(import.meta.url);
import { bytesToHex, concatBytes } from "./noble__hashes.mjs";
import { cbc, ecb } from "./noble__ciphers.mjs";
import { $d636bc798e7178db$export$185802fd694ee1f5 } from "./fontkit+[...].mjs";
import { $557adaaeb0c7885f$exports } from "./linebreak.mjs";
import $52ZIf$fs, { readFileSync, statSync } from "fs";
import stream from "stream";
import zlib$1, { inflate } from "zlib";
import { createRequire } from "module";
// node_modules/png-js/lib/png-js.js
const inflate$2 = inflate;
var PNG = class PNG {
	static decode(path, fn) {
		return $52ZIf$fs.readFile(path, function(err, file) {
			return new PNG(file).decode((pixels) => fn(pixels));
		});
	}
	static load(path) {
		{
			const file = $52ZIf$fs.readFileSync(path);
			return new PNG(file);
		}
	}
	constructor(data) {
		let i;
		this.data = data;
		this.pos = 8;
		this.palette = [];
		this.imgData = [];
		this.transparency = {};
		this.text = {};
		while (true) {
			const chunkSize = this.readUInt32();
			let section = "";
			for (i = 0; i < 4; i++) section += String.fromCharCode(this.data[this.pos++]);
			switch (section) {
				case "IHDR":
					this.width = this.readUInt32();
					this.height = this.readUInt32();
					this.bits = this.data[this.pos++];
					this.colorType = this.data[this.pos++];
					this.compressionMethod = this.data[this.pos++];
					this.filterMethod = this.data[this.pos++];
					this.interlaceMethod = this.data[this.pos++];
					break;
				case "PLTE":
					this.palette = this.read(chunkSize);
					break;
				case "IDAT":
					for (i = 0; i < chunkSize; i++) this.imgData.push(this.data[this.pos++]);
					break;
				case "tRNS":
					this.transparency = {};
					switch (this.colorType) {
						case 3:
							this.transparency.indexed = this.read(chunkSize);
							var short = 255 - this.transparency.indexed.length;
							if (short > 0) for (i = 0; i < short; i++) this.transparency.indexed.push(255);
							break;
						case 0:
							this.transparency.grayscale = this.read(chunkSize)[0];
							break;
						case 2: this.transparency.rgb = this.read(chunkSize);
					}
					break;
				case "tEXt":
					var text = this.read(chunkSize);
					var index = text.indexOf(0);
					var key = String.fromCharCode.apply(String, text.slice(0, index));
					this.text[key] = String.fromCharCode.apply(String, text.slice(index + 1));
					break;
				case "IEND":
					switch (this.colorType) {
						case 0:
						case 3:
						case 4:
							this.colors = 1;
							break;
						case 2:
						case 6: this.colors = 3;
					}
					this.hasAlphaChannel = [4, 6].includes(this.colorType);
					var colors = this.colors + (this.hasAlphaChannel ? 1 : 0);
					this.pixelBitlength = this.bits * colors;
					switch (this.colors) {
						case 1:
							this.colorSpace = "DeviceGray";
							break;
						case 3: this.colorSpace = "DeviceRGB";
					}
					this.imgData = new Uint8Array(this.imgData);
					return;
				default: this.pos += chunkSize;
			}
			this.pos += 4;
			if (this.pos > this.data.length) throw new Error("Incomplete or corrupt PNG file");
		}
	}
	read(bytes) {
		const result = new Array(bytes);
		for (let i = 0; i < bytes; i++) result[i] = this.data[this.pos++];
		return result;
	}
	readUInt32() {
		const b1 = this.data[this.pos++] << 24;
		const b2 = this.data[this.pos++] << 16;
		const b3 = this.data[this.pos++] << 8;
		const b4 = this.data[this.pos++];
		return b1 | b2 | b3 | b4;
	}
	readUInt16() {
		return this.data[this.pos++] << 8 | this.data[this.pos++];
	}
	decodePixels(fn) {
		return inflate$2(new Uint8Array(this.imgData), (err, data) => {
			if (err) throw err;
			const { width, height } = this;
			const pixelBytes = this.pixelBitlength / 8;
			const pixels = new Uint8Array(width * height * pixelBytes);
			const { length } = data;
			let pos = 0;
			function pass(x0, y0, dx, dy, singlePass = false) {
				const w = Math.ceil((width - x0) / dx);
				const h = Math.ceil((height - y0) / dy);
				const scanlineLength = pixelBytes * w;
				const buffer = singlePass ? pixels : new Uint8Array(scanlineLength * h);
				let row = 0;
				let c = 0;
				while (row < h && pos < length) {
					var byte, col, i, left, upper;
					switch (data[pos++]) {
						case 0:
							for (i = 0; i < scanlineLength; i++) buffer[c++] = data[pos++];
							break;
						case 1:
							for (i = 0; i < scanlineLength; i++) {
								byte = data[pos++];
								left = i < pixelBytes ? 0 : buffer[c - pixelBytes];
								buffer[c++] = (byte + left) % 256;
							}
							break;
						case 2:
							for (i = 0; i < scanlineLength; i++) {
								byte = data[pos++];
								col = (i - i % pixelBytes) / pixelBytes;
								upper = row && buffer[(row - 1) * scanlineLength + col * pixelBytes + i % pixelBytes];
								buffer[c++] = (upper + byte) % 256;
							}
							break;
						case 3:
							for (i = 0; i < scanlineLength; i++) {
								byte = data[pos++];
								col = (i - i % pixelBytes) / pixelBytes;
								left = i < pixelBytes ? 0 : buffer[c - pixelBytes];
								upper = row && buffer[(row - 1) * scanlineLength + col * pixelBytes + i % pixelBytes];
								buffer[c++] = (byte + Math.floor((left + upper) / 2)) % 256;
							}
							break;
						case 4:
							for (i = 0; i < scanlineLength; i++) {
								var paeth, upperLeft;
								byte = data[pos++];
								col = (i - i % pixelBytes) / pixelBytes;
								left = i < pixelBytes ? 0 : buffer[c - pixelBytes];
								if (row === 0) upper = upperLeft = 0;
								else {
									upper = buffer[(row - 1) * scanlineLength + col * pixelBytes + i % pixelBytes];
									upperLeft = col && buffer[(row - 1) * scanlineLength + (col - 1) * pixelBytes + i % pixelBytes];
								}
								const p = left + upper - upperLeft;
								const pa = Math.abs(p - left);
								const pb = Math.abs(p - upper);
								const pc = Math.abs(p - upperLeft);
								if (pa <= pb && pa <= pc) paeth = left;
								else if (pb <= pc) paeth = upper;
								else paeth = upperLeft;
								buffer[c++] = (byte + paeth) % 256;
							}
							break;
						default: throw new Error(`Invalid filter algorithm: ${data[pos - 1]}`);
					}
					if (!singlePass) {
						let pixelsPos = ((y0 + row * dy) * width + x0) * pixelBytes;
						let bufferPos = row * scanlineLength;
						for (i = 0; i < w; i++) {
							for (let j = 0; j < pixelBytes; j++) pixels[pixelsPos++] = buffer[bufferPos++];
							pixelsPos += (dx - 1) * pixelBytes;
						}
					}
					row++;
				}
			}
			if (this.interlaceMethod === 1) {
				pass(0, 0, 8, 8);
				pass(4, 0, 8, 8);
				pass(0, 4, 4, 8);
				pass(2, 0, 4, 4);
				pass(0, 2, 2, 4);
				pass(1, 0, 2, 2);
				pass(0, 1, 1, 2);
			} else pass(0, 0, 1, 1, true);
			return fn(pixels);
		});
	}
	decodePalette() {
		const { palette } = this;
		const { length } = palette;
		const transparency = this.transparency.indexed || [];
		const ret = new Uint8Array(transparency.length + length);
		let pos = 0;
		let c = 0;
		for (let i = 0; i < length; i += 3) {
			var left;
			ret[pos++] = palette[i];
			ret[pos++] = palette[i + 1];
			ret[pos++] = palette[i + 2];
			ret[pos++] = (left = transparency[c++]) != null ? left : 255;
		}
		return ret;
	}
	copyToImageData(imageData, pixels) {
		let j, k;
		let { colors } = this;
		let palette = null;
		let alpha = this.hasAlphaChannel;
		if (this.palette.length) {
			palette = this._decodedPalette || (this._decodedPalette = this.decodePalette());
			colors = 4;
			alpha = true;
		}
		const data = imageData.data || imageData;
		const { length } = data;
		const input = palette || pixels;
		let i = j = 0;
		if (colors === 1) while (i < length) {
			k = palette ? pixels[i / 4] * 4 : j;
			const v = input[k++];
			data[i++] = v;
			data[i++] = v;
			data[i++] = v;
			data[i++] = alpha ? input[k++] : 255;
			j = k;
		}
		else while (i < length) {
			k = palette ? pixels[i / 4] * 4 : j;
			data[i++] = input[k++];
			data[i++] = input[k++];
			data[i++] = input[k++];
			data[i++] = alpha ? input[k++] : 255;
			j = k;
		}
	}
	decode(fn) {
		const ret = new Uint8Array(this.width * this.height * 4);
		return this.decodePixels((pixels) => {
			this.copyToImageData(ret, pixels);
			return fn(ret);
		});
	}
};
// node_modules/pdfkit/js/pdfkit.node.mjs
var Readable = stream.Readable;
var PDFAbstractReference = class {
	toString() {
		throw new Error("Must be implemented by subclasses");
	}
};
var PDFTree = class {
	constructor(options = {}) {
		this._items = {};
		this.limits = typeof options.limits === "boolean" ? options.limits : true;
	}
	add(key, val) {
		return this._items[key] = val;
	}
	get(key) {
		return this._items[key];
	}
	toString(encryptFn = null) {
		const sortedKeys = Object.keys(this._items).sort((a, b) => this._compareKeys(a, b));
		const out = ["<<"];
		if (this.limits && sortedKeys.length > 1) {
			const first = sortedKeys[0], last = sortedKeys[sortedKeys.length - 1];
			out.push(`  /Limits ${PDFObject.convert([this._dataForKey(first), this._dataForKey(last)], encryptFn)}`);
		}
		out.push(`  /${this._keysName()} [`);
		for (let key of sortedKeys) out.push(`    ${PDFObject.convert(this._dataForKey(key), encryptFn)} ${PDFObject.convert(this._items[key], encryptFn)}`);
		out.push("]");
		out.push(">>");
		return out.join("\n");
	}
	_compareKeys() {
		throw new Error("Must be implemented by subclasses");
	}
	_keysName() {
		throw new Error("Must be implemented by subclasses");
	}
	_dataForKey() {
		throw new Error("Must be implemented by subclasses");
	}
};
var SpotColor = class {
	constructor(doc, name, C, M, Y, K) {
		this.id = "CS" + Object.keys(doc.spotColors).length;
		this.name = name;
		this.values = [
			C,
			M,
			Y,
			K
		];
		this.ref = doc.ref([
			"Separation",
			escapeName(this.name),
			"DeviceCMYK",
			{
				Range: [
					0,
					1,
					0,
					1,
					0,
					1,
					0,
					1
				],
				C0: [
					0,
					0,
					0,
					0
				],
				C1: this.values.map((value) => value / 100),
				FunctionType: 2,
				Domain: [0, 1],
				N: 1
			}
		]);
		this.ref.end();
	}
	toString() {
		return `${this.ref.id} 0 R`;
	}
};
const toBinaryString = (bytes) => {
	const chunkSize = 32768;
	let out = "";
	for (let i = 0; i < bytes.length; i += chunkSize) {
		const end = Math.min(i + chunkSize, bytes.length);
		out += String.fromCharCode.apply(null, bytes.subarray(i, end));
	}
	return out;
};
const fromBinaryString = (str) => {
	const out = new Uint8Array(str.length);
	for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 255;
	return out;
};
const fromBase64 = (b64) => {
	const binary = atob(b64);
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
	return out;
};
const concat = (chunks) => {
	let length = 0;
	for (const chunk of chunks) length += chunk.length;
	const out = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
};
const toUTF16BE = (str) => {
	const out = new Uint8Array((str.length + 1) * 2);
	out[0] = 254;
	out[1] = 255;
	for (let i = 0; i < str.length; i++) {
		const code = str.charCodeAt(i);
		out[i * 2 + 2] = code >> 8;
		out[i * 2 + 3] = code & 255;
	}
	return out;
};
const readUInt16BE = (bytes, offset = 0) => (bytes[offset] << 8 | bytes[offset + 1]) >>> 0;
const readUInt16LE = (bytes, offset = 0) => (bytes[offset + 1] << 8 | bytes[offset]) >>> 0;
const readUInt32BE = (bytes, offset = 0) => bytes[offset] * 16777216 + (bytes[offset + 1] << 16 | bytes[offset + 2] << 8 | bytes[offset + 3]) >>> 0;
const readUInt32LE = (bytes, offset = 0) => (bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16) + bytes[offset + 3] * 16777216 >>> 0;
const pad = (str, length) => (Array(length + 1).join("0") + str).slice(-length);
const isSafeCharCode = (code) => {
	if (code > 127) return true;
	return code > 32 && code !== 127 && code !== 35 && code !== 37 && code !== 40 && code !== 41 && code !== 47 && code !== 60 && code !== 62 && code !== 91 && code !== 93 && code !== 123 && code !== 125;
};
const escapableRe = /[\n\r\t\b\f()\\]/g;
const escapable = {
	"\n": "\\n",
	"\r": "\\r",
	"	": "\\t",
	"\b": "\\b",
	"\f": "\\f",
	"\\": "\\\\",
	"(": "\\(",
	")": "\\)"
};
const escapeName = function(name) {
	let escapedName = "";
	for (const char of name) {
		const code = char.charCodeAt(0);
		if (isSafeCharCode(code)) escapedName += char;
		else escapedName += `#${code.toString(16).toUpperCase().padStart(2, "0")}`;
	}
	return escapedName;
};
var PDFObject = class PDFObject {
	static convert(object, encryptFn = null) {
		if (typeof object === "string") return `/${object}`;
		else if (object instanceof String) {
			let string = object;
			let isUnicode = false;
			for (let i = 0, end = string.length; i < end; i++) if (string.charCodeAt(i) > 127) {
				isUnicode = true;
				break;
			}
			let stringBytes;
			if (isUnicode) stringBytes = toUTF16BE(string.valueOf());
			else stringBytes = fromBinaryString(string.valueOf());
			if (encryptFn) stringBytes = encryptFn(stringBytes);
			string = toBinaryString(stringBytes);
			string = string.replace(escapableRe, (c) => escapable[c]);
			return `(${string})`;
		} else if (object instanceof Uint8Array) return `<${bytesToHex(object)}>`;
		else if (object instanceof PDFTree) return object.toString(encryptFn);
		else if (object instanceof PDFAbstractReference || object instanceof SpotColor) return object.toString();
		else if (object instanceof Date) {
			let string = `D:${pad(object.getUTCFullYear(), 4)}` + pad(object.getUTCMonth() + 1, 2) + pad(object.getUTCDate(), 2) + pad(object.getUTCHours(), 2) + pad(object.getUTCMinutes(), 2) + pad(object.getUTCSeconds(), 2) + "Z";
			if (encryptFn) {
				string = toBinaryString(encryptFn(fromBinaryString(string)));
				string = string.replace(escapableRe, (c) => escapable[c]);
			}
			return `(${string})`;
		} else if (Array.isArray(object)) {
			const items = [];
			for (let i = 0; i < object.length; i++) {
				const e = object[i];
				items.push(PDFObject.convert(e === void 0 ? null : e, encryptFn));
			}
			return `[${items.join(" ")}]`;
		} else if ({}.toString.call(object) === "[object Object]") {
			const out = ["<<"];
			for (let key in object) {
				const val = object[key];
				if (val === void 0) continue;
				out.push(`/${key} ${PDFObject.convert(val, encryptFn)}`);
			}
			out.push(">>");
			return out.join("\n");
		} else if (typeof object === "number") return PDFObject.number(object);
		else return `${object}`;
	}
	static number(n) {
		if (n > -1e21 && n < 1e21) return Math.round(n * 1e6) / 1e6;
		throw new Error(`unsupported number: ${n}`);
	}
};
var zlib = { deflateSync: (data) => zlib$1.deflateSync(data) };
var PDFReference = class extends PDFAbstractReference {
	constructor(document, id, data = {}) {
		super();
		this.document = document;
		this.id = id;
		this.data = data;
		this.gen = 0;
		this.compress = this.document.compress && !this.data.Filter;
		this.uncompressedLength = 0;
		this.buffer = [];
	}
	write(chunk) {
		if (!(chunk instanceof Uint8Array)) chunk = fromBinaryString(chunk + "\n");
		this.uncompressedLength += chunk.length;
		if (this.data.Length == null) this.data.Length = 0;
		this.buffer.push(chunk);
		this.data.Length += chunk.length;
		if (this.compress) this.data.Filter = "FlateDecode";
	}
	end(chunk) {
		if (chunk) this.write(chunk);
		this.finalize();
	}
	finalize() {
		this.offset = this.document._offset;
		const encryptFn = this.document._security ? this.document._security.getEncryptFn(this.id, this.gen) : null;
		if (this.buffer.length) {
			this.buffer = concat(this.buffer);
			if (this.compress) this.buffer = zlib.deflateSync(this.buffer);
			if (encryptFn) this.buffer = encryptFn(this.buffer);
			this.data.Length = this.buffer.length;
		}
		this.document._write(`${this.id} ${this.gen} obj`);
		this.document._write(PDFObject.convert(this.data, encryptFn));
		if (this.buffer.length) {
			this.document._write("stream");
			this.document._write(this.buffer);
			this.buffer = [];
			this.document._write("\nendstream");
		}
		this.document._write("endobj");
		this.document._refEnd(this);
	}
	toString() {
		return `${this.id} ${this.gen} R`;
	}
};
const fArray = /* @__PURE__ */ new Float32Array(1);
const uArray = new Uint32Array(fArray.buffer);
function PDFNumber(n) {
	const rounded = Math.fround(n);
	if (rounded <= n) return rounded;
	fArray[0] = n;
	if (n <= 0) uArray[0] += 1;
	else uArray[0] -= 1;
	return fArray[0];
}
function normalizeSides(sides, defaultDefinition = void 0, transformer = (v) => v) {
	if (sides == null || typeof sides === "object" && Object.keys(sides).length === 0) sides = defaultDefinition;
	if (sides == null || typeof sides !== "object") sides = {
		top: sides,
		right: sides,
		bottom: sides,
		left: sides
	};
	else if (Array.isArray(sides)) {
		if (sides.length === 2) sides = {
			vertical: sides[0],
			horizontal: sides[1]
		};
		else sides = {
			top: sides[0],
			right: sides[1],
			bottom: sides[2],
			left: sides[3]
		};
	}
	if ("vertical" in sides || "horizontal" in sides) sides = {
		top: sides.vertical,
		right: sides.horizontal,
		bottom: sides.vertical,
		left: sides.horizontal
	};
	return {
		top: transformer(sides.top),
		right: transformer(sides.right),
		bottom: transformer(sides.bottom),
		left: transformer(sides.left)
	};
}
const MM_TO_CM = 1 / 10;
const CM_TO_IN = 1 / 2.54;
const PX_TO_IN = 1 / 96;
const IN_TO_PT = 72;
const PC_TO_PT = 12;
function cosine(a) {
	if (a === 0) return 1;
	if (a === 90) return 0;
	if (a === 180) return -1;
	if (a === 270) return 0;
	return Math.cos(a * Math.PI / 180);
}
function sine(a) {
	if (a === 0) return 0;
	if (a === 90) return 1;
	if (a === 180) return 0;
	if (a === 270) return -1;
	return Math.sin(a * Math.PI / 180);
}
const DEFAULT_MARGINS = {
	top: 72,
	left: 72,
	bottom: 72,
	right: 72
};
const SIZES = {
	"4A0": [4767.87, 6740.79],
	"2A0": [3370.39, 4767.87],
	A0: [2383.94, 3370.39],
	A1: [1683.78, 2383.94],
	A2: [1190.55, 1683.78],
	A3: [841.89, 1190.55],
	A4: [595.28, 841.89],
	A5: [419.53, 595.28],
	A6: [297.64, 419.53],
	A7: [209.76, 297.64],
	A8: [147.4, 209.76],
	A9: [104.88, 147.4],
	A10: [73.7, 104.88],
	B0: [2834.65, 4008.19],
	B1: [2004.09, 2834.65],
	B2: [1417.32, 2004.09],
	B3: [1000.63, 1417.32],
	B4: [708.66, 1000.63],
	B5: [498.9, 708.66],
	B6: [354.33, 498.9],
	B7: [249.45, 354.33],
	B8: [175.75, 249.45],
	B9: [124.72, 175.75],
	B10: [87.87, 124.72],
	C0: [2599.37, 3676.54],
	C1: [1836.85, 2599.37],
	C2: [1298.27, 1836.85],
	C3: [918.43, 1298.27],
	C4: [649.13, 918.43],
	C5: [459.21, 649.13],
	C6: [323.15, 459.21],
	C7: [229.61, 323.15],
	C8: [161.57, 229.61],
	C9: [113.39, 161.57],
	C10: [79.37, 113.39],
	RA0: [2437.8, 3458.27],
	RA1: [1729.13, 2437.8],
	RA2: [1218.9, 1729.13],
	RA3: [864.57, 1218.9],
	RA4: [609.45, 864.57],
	SRA0: [2551.18, 3628.35],
	SRA1: [1814.17, 2551.18],
	SRA2: [1275.59, 1814.17],
	SRA3: [907.09, 1275.59],
	SRA4: [637.8, 907.09],
	EXECUTIVE: [521.86, 756],
	FOLIO: [612, 936],
	LEGAL: [612, 1008],
	LETTER: [612, 792],
	TABLOID: [792, 1224]
};
var PDFPage = class {
	constructor(document, options) {
		this.document = document;
		this._options = options;
		this.size = options.size || "letter";
		this.layout = options.layout || "portrait";
		this.userUnit = options.userUnit || 1;
		const dimensions = Array.isArray(this.size) ? this.size : SIZES[this.size.toUpperCase()];
		this.width = dimensions[this.layout === "portrait" ? 0 : 1];
		this.height = dimensions[this.layout === "portrait" ? 1 : 0];
		this.content = this.document.ref();
		this.margins = normalizeSides(options.margin ?? options.margins, DEFAULT_MARGINS, (x) => document.sizeToPoint(x, 0, this));
		this.resources = this.document.ref({ ProcSet: [
			"PDF",
			"Text",
			"ImageB",
			"ImageC",
			"ImageI"
		] });
		this.dictionary = this.document.ref({
			Type: "Page",
			Parent: this.document._root.data.Pages,
			MediaBox: [
				0,
				0,
				this.width,
				this.height
			],
			Contents: this.content,
			Resources: this.resources,
			UserUnit: this.userUnit
		});
		this.markings = [];
	}
	get fonts() {
		const data = this.resources.data;
		return data.Font != null ? data.Font : data.Font = {};
	}
	get xobjects() {
		const data = this.resources.data;
		return data.XObject != null ? data.XObject : data.XObject = {};
	}
	get ext_gstates() {
		const data = this.resources.data;
		return data.ExtGState != null ? data.ExtGState : data.ExtGState = {};
	}
	get patterns() {
		const data = this.resources.data;
		return data.Pattern != null ? data.Pattern : data.Pattern = {};
	}
	get colorSpaces() {
		const data = this.resources.data;
		return data.ColorSpace || (data.ColorSpace = {});
	}
	get annotations() {
		const data = this.dictionary.data;
		return data.Annots != null ? data.Annots : data.Annots = [];
	}
	get structParentTreeKey() {
		const data = this.dictionary.data;
		return data.StructParents != null ? data.StructParents : data.StructParents = this.document.createStructParentTreeNextKey();
	}
	get contentWidth() {
		return this.width - this.margins.left - this.margins.right;
	}
	get contentHeight() {
		return this.height - this.margins.top - this.margins.bottom;
	}
	maxY() {
		return this.height - this.margins.bottom;
	}
	write(chunk) {
		return this.content.write(chunk);
	}
	_setTabOrder() {
		if (!this.dictionary.Tabs && this.document.hasMarkInfoDictionary()) this.dictionary.data.Tabs = "S";
	}
	end() {
		this._setTabOrder();
		this.dictionary.end();
		this.resources.data.ColorSpace = this.resources.data.ColorSpace || {};
		for (let color of Object.values(this.document.spotColors)) this.resources.data.ColorSpace[color.id] = color;
		this.resources.end();
		return this.content.end();
	}
};
var PDFNameTree = class extends PDFTree {
	_compareKeys(a, b) {
		return a.localeCompare(b);
	}
	_keysName() {
		return "Names";
	}
	_dataForKey(k) {
		return new String(k);
	}
};
function isBytes(a) {
	return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
function abytes(b, ...lengths) {
	if (!isBytes(b)) throw new Error("Uint8Array expected");
	if (lengths.length > 0 && !lengths.includes(b.length)) throw new Error("Uint8Array expected of length " + lengths + ", got length=" + b.length);
}
function aexists(instance, checkFinished = true) {
	if (instance.destroyed) throw new Error("Hash instance has been destroyed");
	if (checkFinished && instance.finished) throw new Error("Hash#digest() has already been called");
}
function aoutput(out, instance) {
	abytes(out);
	const min = instance.outputLen;
	if (out.length < min) throw new Error("digestInto() expects output buffer of length at least " + min);
}
function clean(...arrays) {
	for (let i = 0; i < arrays.length; i++) arrays[i].fill(0);
}
function createView(arr) {
	return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
function rotr(word, shift) {
	return word << 32 - shift | word >>> shift;
}
function rotl(word, shift) {
	return word << shift | word >>> 32 - shift >>> 0;
}
(() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
(() => typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function")();
Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
function utf8ToBytes(str) {
	if (typeof str !== "string") throw new Error("string expected");
	return new Uint8Array(new TextEncoder().encode(str));
}
function toBytes(data) {
	if (typeof data === "string") data = utf8ToBytes(data);
	abytes(data);
	return data;
}
var Hash = class {};
function createHasher(hashCons) {
	const hashC = (msg) => hashCons().update(toBytes(msg)).digest();
	const tmp = hashCons();
	hashC.outputLen = tmp.outputLen;
	hashC.blockLen = tmp.blockLen;
	hashC.create = () => hashCons();
	return hashC;
}
function setBigUint64(view, byteOffset, value, isLE) {
	if (typeof view.setBigUint64 === "function") return view.setBigUint64(byteOffset, value, isLE);
	const _32n = BigInt(32);
	const _u32_max = BigInt(4294967295);
	const wh = Number(value >> _32n & _u32_max);
	const wl = Number(value & _u32_max);
	const h = isLE ? 4 : 0;
	const l = isLE ? 0 : 4;
	view.setUint32(byteOffset + h, wh, isLE);
	view.setUint32(byteOffset + l, wl, isLE);
}
function Chi(a, b, c) {
	return a & b ^ ~a & c;
}
function Maj(a, b, c) {
	return a & b ^ a & c ^ b & c;
}
var HashMD = class extends Hash {
	constructor(blockLen, outputLen, padOffset, isLE) {
		super();
		this.finished = false;
		this.length = 0;
		this.pos = 0;
		this.destroyed = false;
		this.blockLen = blockLen;
		this.outputLen = outputLen;
		this.padOffset = padOffset;
		this.isLE = isLE;
		this.buffer = new Uint8Array(blockLen);
		this.view = createView(this.buffer);
	}
	update(data) {
		aexists(this);
		data = toBytes(data);
		abytes(data);
		const { view, buffer, blockLen } = this;
		const len = data.length;
		for (let pos = 0; pos < len;) {
			const take = Math.min(blockLen - this.pos, len - pos);
			if (take === blockLen) {
				const dataView = createView(data);
				for (; blockLen <= len - pos; pos += blockLen) this.process(dataView, pos);
				continue;
			}
			buffer.set(data.subarray(pos, pos + take), this.pos);
			this.pos += take;
			pos += take;
			if (this.pos === blockLen) {
				this.process(view, 0);
				this.pos = 0;
			}
		}
		this.length += data.length;
		this.roundClean();
		return this;
	}
	digestInto(out) {
		aexists(this);
		aoutput(out, this);
		this.finished = true;
		const { buffer, view, blockLen, isLE } = this;
		let { pos } = this;
		buffer[pos++] = 128;
		clean(this.buffer.subarray(pos));
		if (this.padOffset > blockLen - pos) {
			this.process(view, 0);
			pos = 0;
		}
		for (let i = pos; i < blockLen; i++) buffer[i] = 0;
		setBigUint64(view, blockLen - 8, BigInt(this.length * 8), isLE);
		this.process(view, 0);
		const oview = createView(out);
		const len = this.outputLen;
		if (len % 4) throw new Error("_sha2: outputLen should be aligned to 32bit");
		const outLen = len / 4;
		const state = this.get();
		if (outLen > state.length) throw new Error("_sha2: outputLen bigger than state");
		for (let i = 0; i < outLen; i++) oview.setUint32(4 * i, state[i], isLE);
	}
	digest() {
		const { buffer, outputLen } = this;
		this.digestInto(buffer);
		const res = buffer.slice(0, outputLen);
		this.destroy();
		return res;
	}
	_cloneInto(to) {
		to || (to = new this.constructor());
		to.set(...this.get());
		const { blockLen, buffer, length, finished, destroyed, pos } = this;
		to.destroyed = destroyed;
		to.finished = finished;
		to.length = length;
		to.pos = pos;
		if (length % blockLen) to.buffer.set(buffer);
		return to;
	}
	clone() {
		return this._cloneInto();
	}
};
const SHA256_IV = Uint32Array.from([
	1779033703,
	3144134277,
	1013904242,
	2773480762,
	1359893119,
	2600822924,
	528734635,
	1541459225
]);
const SHA224_IV = Uint32Array.from([
	3238371032,
	914150663,
	812702999,
	4144912697,
	4290775857,
	1750603025,
	1694076839,
	3204075428
]);
const SHA384_IV = Uint32Array.from([
	3418070365,
	3238371032,
	1654270250,
	914150663,
	2438529370,
	812702999,
	355462360,
	4144912697,
	1731405415,
	4290775857,
	2394180231,
	1750603025,
	3675008525,
	1694076839,
	1203062813,
	3204075428
]);
const SHA512_IV = Uint32Array.from([
	1779033703,
	4089235720,
	3144134277,
	2227873595,
	1013904242,
	4271175723,
	2773480762,
	1595750129,
	1359893119,
	2917565137,
	2600822924,
	725511199,
	528734635,
	4215389547,
	1541459225,
	327033209
]);
const SHA1_IV = Uint32Array.from([
	1732584193,
	4023233417,
	2562383102,
	271733878,
	3285377520
]);
const SHA1_W = /* @__PURE__ */ new Uint32Array(80);
var SHA1 = class extends HashMD {
	constructor() {
		super(64, 20, 8, false);
		this.A = SHA1_IV[0] | 0;
		this.B = SHA1_IV[1] | 0;
		this.C = SHA1_IV[2] | 0;
		this.D = SHA1_IV[3] | 0;
		this.E = SHA1_IV[4] | 0;
	}
	get() {
		const { A, B, C, D, E } = this;
		return [
			A,
			B,
			C,
			D,
			E
		];
	}
	set(A, B, C, D, E) {
		this.A = A | 0;
		this.B = B | 0;
		this.C = C | 0;
		this.D = D | 0;
		this.E = E | 0;
	}
	process(view, offset) {
		for (let i = 0; i < 16; i++, offset += 4) SHA1_W[i] = view.getUint32(offset, false);
		for (let i = 16; i < 80; i++) SHA1_W[i] = rotl(SHA1_W[i - 3] ^ SHA1_W[i - 8] ^ SHA1_W[i - 14] ^ SHA1_W[i - 16], 1);
		let { A, B, C, D, E } = this;
		for (let i = 0; i < 80; i++) {
			let F, K;
			if (i < 20) {
				F = Chi(B, C, D);
				K = 1518500249;
			} else if (i < 40) {
				F = B ^ C ^ D;
				K = 1859775393;
			} else if (i < 60) {
				F = Maj(B, C, D);
				K = 2400959708;
			} else {
				F = B ^ C ^ D;
				K = 3395469782;
			}
			const T = rotl(A, 5) + F + E + K + SHA1_W[i] | 0;
			E = D;
			D = C;
			C = rotl(B, 30);
			B = A;
			A = T;
		}
		A = A + this.A | 0;
		B = B + this.B | 0;
		C = C + this.C | 0;
		D = D + this.D | 0;
		E = E + this.E | 0;
		this.set(A, B, C, D, E);
	}
	roundClean() {
		clean(SHA1_W);
	}
	destroy() {
		this.set(0, 0, 0, 0, 0);
		clean(this.buffer);
	}
};
createHasher(() => new SHA1());
const p32 = Math.pow(2, 32);
const K = Array.from({ length: 64 }, (_, i) => Math.floor(p32 * Math.abs(Math.sin(i + 1))));
const MD5_IV = SHA1_IV.slice(0, 4);
const MD5_W = /* @__PURE__ */ new Uint32Array(16);
var MD5 = class extends HashMD {
	constructor() {
		super(64, 16, 8, true);
		this.A = MD5_IV[0] | 0;
		this.B = MD5_IV[1] | 0;
		this.C = MD5_IV[2] | 0;
		this.D = MD5_IV[3] | 0;
	}
	get() {
		const { A, B, C, D } = this;
		return [
			A,
			B,
			C,
			D
		];
	}
	set(A, B, C, D) {
		this.A = A | 0;
		this.B = B | 0;
		this.C = C | 0;
		this.D = D | 0;
	}
	process(view, offset) {
		for (let i = 0; i < 16; i++, offset += 4) MD5_W[i] = view.getUint32(offset, true);
		let { A, B, C, D } = this;
		for (let i = 0; i < 64; i++) {
			let F, g, s;
			if (i < 16) {
				F = Chi(B, C, D);
				g = i;
				s = [
					7,
					12,
					17,
					22
				];
			} else if (i < 32) {
				F = Chi(D, B, C);
				g = (5 * i + 1) % 16;
				s = [
					5,
					9,
					14,
					20
				];
			} else if (i < 48) {
				F = B ^ C ^ D;
				g = (3 * i + 5) % 16;
				s = [
					4,
					11,
					16,
					23
				];
			} else {
				F = C ^ (B | ~D);
				g = 7 * i % 16;
				s = [
					6,
					10,
					15,
					21
				];
			}
			F = F + A + K[i] + MD5_W[g];
			A = D;
			D = C;
			C = B;
			B = B + rotl(F, s[i % 4]);
		}
		A = A + this.A | 0;
		B = B + this.B | 0;
		C = C + this.C | 0;
		D = D + this.D | 0;
		this.set(A, B, C, D);
	}
	roundClean() {
		clean(MD5_W);
	}
	destroy() {
		this.set(0, 0, 0, 0);
		clean(this.buffer);
	}
};
const md5 = createHasher(() => new MD5());
const Rho160 = Uint8Array.from([
	7,
	4,
	13,
	1,
	10,
	6,
	15,
	3,
	12,
	0,
	9,
	5,
	2,
	14,
	11,
	8
]);
const Id160 = (() => Uint8Array.from(new Array(16).fill(0).map((_, i) => i)))();
const Pi160 = (() => Id160.map((i) => (9 * i + 5) % 16))();
const idxLR = (() => {
	const res = [[Id160], [Pi160]];
	for (let i = 0; i < 4; i++) for (let j of res) j.push(j[i].map((k) => Rho160[k]));
	return res;
})();
const idxL = (() => idxLR[0])();
const idxR = (() => idxLR[1])();
const shifts160 = [
	[
		11,
		14,
		15,
		12,
		5,
		8,
		7,
		9,
		11,
		13,
		14,
		15,
		6,
		7,
		9,
		8
	],
	[
		12,
		13,
		11,
		15,
		6,
		9,
		9,
		7,
		12,
		15,
		11,
		13,
		7,
		8,
		7,
		7
	],
	[
		13,
		15,
		14,
		11,
		7,
		7,
		6,
		8,
		13,
		14,
		13,
		12,
		5,
		5,
		6,
		9
	],
	[
		14,
		11,
		12,
		14,
		8,
		6,
		5,
		5,
		15,
		12,
		15,
		14,
		9,
		9,
		8,
		6
	],
	[
		15,
		12,
		13,
		13,
		9,
		5,
		8,
		6,
		14,
		11,
		12,
		11,
		8,
		6,
		5,
		5
	]
].map((i) => Uint8Array.from(i));
const shiftsL160 = idxL.map((idx, i) => idx.map((j) => shifts160[i][j]));
const shiftsR160 = idxR.map((idx, i) => idx.map((j) => shifts160[i][j]));
const Kl160 = Uint32Array.from([
	0,
	1518500249,
	1859775393,
	2400959708,
	2840853838
]);
const Kr160 = Uint32Array.from([
	1352829926,
	1548603684,
	1836072691,
	2053994217,
	0
]);
function ripemd_f(group, x, y, z) {
	if (group === 0) return x ^ y ^ z;
	if (group === 1) return x & y | ~x & z;
	if (group === 2) return (x | ~y) ^ z;
	if (group === 3) return x & z | y & ~z;
	return x ^ (y | ~z);
}
const BUF_160 = /* @__PURE__ */ new Uint32Array(16);
var RIPEMD160 = class extends HashMD {
	constructor() {
		super(64, 20, 8, true);
		this.h0 = 1732584193;
		this.h1 = -271733879;
		this.h2 = -1732584194;
		this.h3 = 271733878;
		this.h4 = -1009589776;
	}
	get() {
		const { h0, h1, h2, h3, h4 } = this;
		return [
			h0,
			h1,
			h2,
			h3,
			h4
		];
	}
	set(h0, h1, h2, h3, h4) {
		this.h0 = h0 | 0;
		this.h1 = h1 | 0;
		this.h2 = h2 | 0;
		this.h3 = h3 | 0;
		this.h4 = h4 | 0;
	}
	process(view, offset) {
		for (let i = 0; i < 16; i++, offset += 4) BUF_160[i] = view.getUint32(offset, true);
		let al = this.h0 | 0, ar = al, bl = this.h1 | 0, br = bl, cl = this.h2 | 0, cr = cl, dl = this.h3 | 0, dr = dl, el = this.h4 | 0, er = el;
		for (let group = 0; group < 5; group++) {
			const rGroup = 4 - group;
			const hbl = Kl160[group], hbr = Kr160[group];
			const rl = idxL[group], rr = idxR[group];
			const sl = shiftsL160[group], sr = shiftsR160[group];
			for (let i = 0; i < 16; i++) {
				const tl = rotl(al + ripemd_f(group, bl, cl, dl) + BUF_160[rl[i]] + hbl, sl[i]) + el | 0;
				al = el, el = dl, dl = rotl(cl, 10) | 0, cl = bl, bl = tl;
			}
			for (let i = 0; i < 16; i++) {
				const tr = rotl(ar + ripemd_f(rGroup, br, cr, dr) + BUF_160[rr[i]] + hbr, sr[i]) + er | 0;
				ar = er, er = dr, dr = rotl(cr, 10) | 0, cr = br, br = tr;
			}
		}
		this.set(this.h1 + cl + dr | 0, this.h2 + dl + er | 0, this.h3 + el + ar | 0, this.h4 + al + br | 0, this.h0 + bl + cr | 0);
	}
	roundClean() {
		clean(BUF_160);
	}
	destroy() {
		this.destroyed = true;
		clean(this.buffer);
		this.set(0, 0, 0, 0, 0);
	}
};
createHasher(() => new RIPEMD160());
function md5Hash(data) {
	return md5.create().update(data).digest();
}
function md5Hex(data) {
	return bytesToHex(md5Hash(data));
}
const U32_MASK64 = BigInt(2 ** 32 - 1);
const _32n = BigInt(32);
function fromBig(n, le = false) {
	if (le) return {
		h: Number(n & U32_MASK64),
		l: Number(n >> _32n & U32_MASK64)
	};
	return {
		h: Number(n >> _32n & U32_MASK64) | 0,
		l: Number(n & U32_MASK64) | 0
	};
}
function split(lst, le = false) {
	const len = lst.length;
	let Ah = new Uint32Array(len);
	let Al = new Uint32Array(len);
	for (let i = 0; i < len; i++) {
		const { h, l } = fromBig(lst[i], le);
		[Ah[i], Al[i]] = [h, l];
	}
	return [Ah, Al];
}
const shrSH = (h, _l, s) => h >>> s;
const shrSL = (h, l, s) => h << 32 - s | l >>> s;
const rotrSH = (h, l, s) => h >>> s | l << 32 - s;
const rotrSL = (h, l, s) => h << 32 - s | l >>> s;
const rotrBH = (h, l, s) => h << 64 - s | l >>> s - 32;
const rotrBL = (h, l, s) => h >>> s - 32 | l << 64 - s;
function add(Ah, Al, Bh, Bl) {
	const l = (Al >>> 0) + (Bl >>> 0);
	return {
		h: Ah + Bh + (l / 2 ** 32 | 0) | 0,
		l: l | 0
	};
}
const add3L = (Al, Bl, Cl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0);
const add3H = (low, Ah, Bh, Ch) => Ah + Bh + Ch + (low / 2 ** 32 | 0) | 0;
const add4L = (Al, Bl, Cl, Dl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0);
const add4H = (low, Ah, Bh, Ch, Dh) => Ah + Bh + Ch + Dh + (low / 2 ** 32 | 0) | 0;
const add5L = (Al, Bl, Cl, Dl, El) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0) + (El >>> 0);
const add5H = (low, Ah, Bh, Ch, Dh, Eh) => Ah + Bh + Ch + Dh + Eh + (low / 2 ** 32 | 0) | 0;
const SHA256_K = Uint32Array.from([
	1116352408,
	1899447441,
	3049323471,
	3921009573,
	961987163,
	1508970993,
	2453635748,
	2870763221,
	3624381080,
	310598401,
	607225278,
	1426881987,
	1925078388,
	2162078206,
	2614888103,
	3248222580,
	3835390401,
	4022224774,
	264347078,
	604807628,
	770255983,
	1249150122,
	1555081692,
	1996064986,
	2554220882,
	2821834349,
	2952996808,
	3210313671,
	3336571891,
	3584528711,
	113926993,
	338241895,
	666307205,
	773529912,
	1294757372,
	1396182291,
	1695183700,
	1986661051,
	2177026350,
	2456956037,
	2730485921,
	2820302411,
	3259730800,
	3345764771,
	3516065817,
	3600352804,
	4094571909,
	275423344,
	430227734,
	506948616,
	659060556,
	883997877,
	958139571,
	1322822218,
	1537002063,
	1747873779,
	1955562222,
	2024104815,
	2227730452,
	2361852424,
	2428436474,
	2756734187,
	3204031479,
	3329325298
]);
const SHA256_W = /* @__PURE__ */ new Uint32Array(64);
var SHA256 = class extends HashMD {
	constructor(outputLen = 32) {
		super(64, outputLen, 8, false);
		this.A = SHA256_IV[0] | 0;
		this.B = SHA256_IV[1] | 0;
		this.C = SHA256_IV[2] | 0;
		this.D = SHA256_IV[3] | 0;
		this.E = SHA256_IV[4] | 0;
		this.F = SHA256_IV[5] | 0;
		this.G = SHA256_IV[6] | 0;
		this.H = SHA256_IV[7] | 0;
	}
	get() {
		const { A, B, C, D, E, F, G, H } = this;
		return [
			A,
			B,
			C,
			D,
			E,
			F,
			G,
			H
		];
	}
	set(A, B, C, D, E, F, G, H) {
		this.A = A | 0;
		this.B = B | 0;
		this.C = C | 0;
		this.D = D | 0;
		this.E = E | 0;
		this.F = F | 0;
		this.G = G | 0;
		this.H = H | 0;
	}
	process(view, offset) {
		for (let i = 0; i < 16; i++, offset += 4) SHA256_W[i] = view.getUint32(offset, false);
		for (let i = 16; i < 64; i++) {
			const W15 = SHA256_W[i - 15];
			const W2 = SHA256_W[i - 2];
			const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
			const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
			SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
		}
		let { A, B, C, D, E, F, G, H } = this;
		for (let i = 0; i < 64; i++) {
			const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
			const T1 = H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
			const T2 = (rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22)) + Maj(A, B, C) | 0;
			H = G;
			G = F;
			F = E;
			E = D + T1 | 0;
			D = C;
			C = B;
			B = A;
			A = T1 + T2 | 0;
		}
		A = A + this.A | 0;
		B = B + this.B | 0;
		C = C + this.C | 0;
		D = D + this.D | 0;
		E = E + this.E | 0;
		F = F + this.F | 0;
		G = G + this.G | 0;
		H = H + this.H | 0;
		this.set(A, B, C, D, E, F, G, H);
	}
	roundClean() {
		clean(SHA256_W);
	}
	destroy() {
		this.set(0, 0, 0, 0, 0, 0, 0, 0);
		clean(this.buffer);
	}
};
var SHA224 = class extends SHA256 {
	constructor() {
		super(28);
		this.A = SHA224_IV[0] | 0;
		this.B = SHA224_IV[1] | 0;
		this.C = SHA224_IV[2] | 0;
		this.D = SHA224_IV[3] | 0;
		this.E = SHA224_IV[4] | 0;
		this.F = SHA224_IV[5] | 0;
		this.G = SHA224_IV[6] | 0;
		this.H = SHA224_IV[7] | 0;
	}
};
const K512 = (() => split([
	"0x428a2f98d728ae22",
	"0x7137449123ef65cd",
	"0xb5c0fbcfec4d3b2f",
	"0xe9b5dba58189dbbc",
	"0x3956c25bf348b538",
	"0x59f111f1b605d019",
	"0x923f82a4af194f9b",
	"0xab1c5ed5da6d8118",
	"0xd807aa98a3030242",
	"0x12835b0145706fbe",
	"0x243185be4ee4b28c",
	"0x550c7dc3d5ffb4e2",
	"0x72be5d74f27b896f",
	"0x80deb1fe3b1696b1",
	"0x9bdc06a725c71235",
	"0xc19bf174cf692694",
	"0xe49b69c19ef14ad2",
	"0xefbe4786384f25e3",
	"0x0fc19dc68b8cd5b5",
	"0x240ca1cc77ac9c65",
	"0x2de92c6f592b0275",
	"0x4a7484aa6ea6e483",
	"0x5cb0a9dcbd41fbd4",
	"0x76f988da831153b5",
	"0x983e5152ee66dfab",
	"0xa831c66d2db43210",
	"0xb00327c898fb213f",
	"0xbf597fc7beef0ee4",
	"0xc6e00bf33da88fc2",
	"0xd5a79147930aa725",
	"0x06ca6351e003826f",
	"0x142929670a0e6e70",
	"0x27b70a8546d22ffc",
	"0x2e1b21385c26c926",
	"0x4d2c6dfc5ac42aed",
	"0x53380d139d95b3df",
	"0x650a73548baf63de",
	"0x766a0abb3c77b2a8",
	"0x81c2c92e47edaee6",
	"0x92722c851482353b",
	"0xa2bfe8a14cf10364",
	"0xa81a664bbc423001",
	"0xc24b8b70d0f89791",
	"0xc76c51a30654be30",
	"0xd192e819d6ef5218",
	"0xd69906245565a910",
	"0xf40e35855771202a",
	"0x106aa07032bbd1b8",
	"0x19a4c116b8d2d0c8",
	"0x1e376c085141ab53",
	"0x2748774cdf8eeb99",
	"0x34b0bcb5e19b48a8",
	"0x391c0cb3c5c95a63",
	"0x4ed8aa4ae3418acb",
	"0x5b9cca4f7763e373",
	"0x682e6ff3d6b2b8a3",
	"0x748f82ee5defb2fc",
	"0x78a5636f43172f60",
	"0x84c87814a1f0ab72",
	"0x8cc702081a6439ec",
	"0x90befffa23631e28",
	"0xa4506cebde82bde9",
	"0xbef9a3f7b2c67915",
	"0xc67178f2e372532b",
	"0xca273eceea26619c",
	"0xd186b8c721c0c207",
	"0xeada7dd6cde0eb1e",
	"0xf57d4f7fee6ed178",
	"0x06f067aa72176fba",
	"0x0a637dc5a2c898a6",
	"0x113f9804bef90dae",
	"0x1b710b35131c471b",
	"0x28db77f523047d84",
	"0x32caab7b40c72493",
	"0x3c9ebe0a15c9bebc",
	"0x431d67c49c100d4c",
	"0x4cc5d4becb3e42b6",
	"0x597f299cfc657e2a",
	"0x5fcb6fab3ad6faec",
	"0x6c44198c4a475817"
].map((n) => BigInt(n))))();
const SHA512_Kh = (() => K512[0])();
const SHA512_Kl = (() => K512[1])();
const SHA512_W_H = /* @__PURE__ */ new Uint32Array(80);
const SHA512_W_L = /* @__PURE__ */ new Uint32Array(80);
var SHA512 = class extends HashMD {
	constructor(outputLen = 64) {
		super(128, outputLen, 16, false);
		this.Ah = SHA512_IV[0] | 0;
		this.Al = SHA512_IV[1] | 0;
		this.Bh = SHA512_IV[2] | 0;
		this.Bl = SHA512_IV[3] | 0;
		this.Ch = SHA512_IV[4] | 0;
		this.Cl = SHA512_IV[5] | 0;
		this.Dh = SHA512_IV[6] | 0;
		this.Dl = SHA512_IV[7] | 0;
		this.Eh = SHA512_IV[8] | 0;
		this.El = SHA512_IV[9] | 0;
		this.Fh = SHA512_IV[10] | 0;
		this.Fl = SHA512_IV[11] | 0;
		this.Gh = SHA512_IV[12] | 0;
		this.Gl = SHA512_IV[13] | 0;
		this.Hh = SHA512_IV[14] | 0;
		this.Hl = SHA512_IV[15] | 0;
	}
	get() {
		const { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
		return [
			Ah,
			Al,
			Bh,
			Bl,
			Ch,
			Cl,
			Dh,
			Dl,
			Eh,
			El,
			Fh,
			Fl,
			Gh,
			Gl,
			Hh,
			Hl
		];
	}
	set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl) {
		this.Ah = Ah | 0;
		this.Al = Al | 0;
		this.Bh = Bh | 0;
		this.Bl = Bl | 0;
		this.Ch = Ch | 0;
		this.Cl = Cl | 0;
		this.Dh = Dh | 0;
		this.Dl = Dl | 0;
		this.Eh = Eh | 0;
		this.El = El | 0;
		this.Fh = Fh | 0;
		this.Fl = Fl | 0;
		this.Gh = Gh | 0;
		this.Gl = Gl | 0;
		this.Hh = Hh | 0;
		this.Hl = Hl | 0;
	}
	process(view, offset) {
		for (let i = 0; i < 16; i++, offset += 4) {
			SHA512_W_H[i] = view.getUint32(offset);
			SHA512_W_L[i] = view.getUint32(offset += 4);
		}
		for (let i = 16; i < 80; i++) {
			const W15h = SHA512_W_H[i - 15] | 0;
			const W15l = SHA512_W_L[i - 15] | 0;
			const s0h = rotrSH(W15h, W15l, 1) ^ rotrSH(W15h, W15l, 8) ^ shrSH(W15h, W15l, 7);
			const s0l = rotrSL(W15h, W15l, 1) ^ rotrSL(W15h, W15l, 8) ^ shrSL(W15h, W15l, 7);
			const W2h = SHA512_W_H[i - 2] | 0;
			const W2l = SHA512_W_L[i - 2] | 0;
			const s1h = rotrSH(W2h, W2l, 19) ^ rotrBH(W2h, W2l, 61) ^ shrSH(W2h, W2l, 6);
			const s1l = rotrSL(W2h, W2l, 19) ^ rotrBL(W2h, W2l, 61) ^ shrSL(W2h, W2l, 6);
			const SUMl = add4L(s0l, s1l, SHA512_W_L[i - 7], SHA512_W_L[i - 16]);
			const SUMh = add4H(SUMl, s0h, s1h, SHA512_W_H[i - 7], SHA512_W_H[i - 16]);
			SHA512_W_H[i] = SUMh | 0;
			SHA512_W_L[i] = SUMl | 0;
		}
		let { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
		for (let i = 0; i < 80; i++) {
			const sigma1h = rotrSH(Eh, El, 14) ^ rotrSH(Eh, El, 18) ^ rotrBH(Eh, El, 41);
			const sigma1l = rotrSL(Eh, El, 14) ^ rotrSL(Eh, El, 18) ^ rotrBL(Eh, El, 41);
			const CHIh = Eh & Fh ^ ~Eh & Gh;
			const CHIl = El & Fl ^ ~El & Gl;
			const T1ll = add5L(Hl, sigma1l, CHIl, SHA512_Kl[i], SHA512_W_L[i]);
			const T1h = add5H(T1ll, Hh, sigma1h, CHIh, SHA512_Kh[i], SHA512_W_H[i]);
			const T1l = T1ll | 0;
			const sigma0h = rotrSH(Ah, Al, 28) ^ rotrBH(Ah, Al, 34) ^ rotrBH(Ah, Al, 39);
			const sigma0l = rotrSL(Ah, Al, 28) ^ rotrBL(Ah, Al, 34) ^ rotrBL(Ah, Al, 39);
			const MAJh = Ah & Bh ^ Ah & Ch ^ Bh & Ch;
			const MAJl = Al & Bl ^ Al & Cl ^ Bl & Cl;
			Hh = Gh | 0;
			Hl = Gl | 0;
			Gh = Fh | 0;
			Gl = Fl | 0;
			Fh = Eh | 0;
			Fl = El | 0;
			({h: Eh, l: El} = add(Dh | 0, Dl | 0, T1h | 0, T1l | 0));
			Dh = Ch | 0;
			Dl = Cl | 0;
			Ch = Bh | 0;
			Cl = Bl | 0;
			Bh = Ah | 0;
			Bl = Al | 0;
			const All = add3L(T1l, sigma0l, MAJl);
			Ah = add3H(All, T1h, sigma0h, MAJh);
			Al = All | 0;
		}
		({h: Ah, l: Al} = add(this.Ah | 0, this.Al | 0, Ah | 0, Al | 0));
		({h: Bh, l: Bl} = add(this.Bh | 0, this.Bl | 0, Bh | 0, Bl | 0));
		({h: Ch, l: Cl} = add(this.Ch | 0, this.Cl | 0, Ch | 0, Cl | 0));
		({h: Dh, l: Dl} = add(this.Dh | 0, this.Dl | 0, Dh | 0, Dl | 0));
		({h: Eh, l: El} = add(this.Eh | 0, this.El | 0, Eh | 0, El | 0));
		({h: Fh, l: Fl} = add(this.Fh | 0, this.Fl | 0, Fh | 0, Fl | 0));
		({h: Gh, l: Gl} = add(this.Gh | 0, this.Gl | 0, Gh | 0, Gl | 0));
		({h: Hh, l: Hl} = add(this.Hh | 0, this.Hl | 0, Hh | 0, Hl | 0));
		this.set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl);
	}
	roundClean() {
		clean(SHA512_W_H, SHA512_W_L);
	}
	destroy() {
		clean(this.buffer);
		this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
	}
};
var SHA384 = class extends SHA512 {
	constructor() {
		super(48);
		this.Ah = SHA384_IV[0] | 0;
		this.Al = SHA384_IV[1] | 0;
		this.Bh = SHA384_IV[2] | 0;
		this.Bl = SHA384_IV[3] | 0;
		this.Ch = SHA384_IV[4] | 0;
		this.Cl = SHA384_IV[5] | 0;
		this.Dh = SHA384_IV[6] | 0;
		this.Dl = SHA384_IV[7] | 0;
		this.Eh = SHA384_IV[8] | 0;
		this.El = SHA384_IV[9] | 0;
		this.Fh = SHA384_IV[10] | 0;
		this.Fl = SHA384_IV[11] | 0;
		this.Gh = SHA384_IV[12] | 0;
		this.Gl = SHA384_IV[13] | 0;
		this.Hh = SHA384_IV[14] | 0;
		this.Hl = SHA384_IV[15] | 0;
	}
};
const T224_IV = Uint32Array.from([
	2352822216,
	424955298,
	1944164710,
	2312950998,
	502970286,
	855612546,
	1738396948,
	1479516111,
	258812777,
	2077511080,
	2011393907,
	79989058,
	1067287976,
	1780299464,
	286451373,
	2446758561
]);
const T256_IV = Uint32Array.from([
	573645204,
	4230739756,
	2673172387,
	3360449730,
	596883563,
	1867755857,
	2520282905,
	1497426621,
	2519219938,
	2827943907,
	3193839141,
	1401305490,
	721525244,
	746961066,
	246885852,
	2177182882
]);
var SHA512_224 = class extends SHA512 {
	constructor() {
		super(28);
		this.Ah = T224_IV[0] | 0;
		this.Al = T224_IV[1] | 0;
		this.Bh = T224_IV[2] | 0;
		this.Bl = T224_IV[3] | 0;
		this.Ch = T224_IV[4] | 0;
		this.Cl = T224_IV[5] | 0;
		this.Dh = T224_IV[6] | 0;
		this.Dl = T224_IV[7] | 0;
		this.Eh = T224_IV[8] | 0;
		this.El = T224_IV[9] | 0;
		this.Fh = T224_IV[10] | 0;
		this.Fl = T224_IV[11] | 0;
		this.Gh = T224_IV[12] | 0;
		this.Gl = T224_IV[13] | 0;
		this.Hh = T224_IV[14] | 0;
		this.Hl = T224_IV[15] | 0;
	}
};
var SHA512_256 = class extends SHA512 {
	constructor() {
		super(32);
		this.Ah = T256_IV[0] | 0;
		this.Al = T256_IV[1] | 0;
		this.Bh = T256_IV[2] | 0;
		this.Bl = T256_IV[3] | 0;
		this.Ch = T256_IV[4] | 0;
		this.Cl = T256_IV[5] | 0;
		this.Dh = T256_IV[6] | 0;
		this.Dl = T256_IV[7] | 0;
		this.Eh = T256_IV[8] | 0;
		this.El = T256_IV[9] | 0;
		this.Fh = T256_IV[10] | 0;
		this.Fl = T256_IV[11] | 0;
		this.Gh = T256_IV[12] | 0;
		this.Gl = T256_IV[13] | 0;
		this.Hh = T256_IV[14] | 0;
		this.Hl = T256_IV[15] | 0;
	}
};
const sha256 = createHasher(() => new SHA256());
createHasher(() => new SHA224());
createHasher(() => new SHA512());
createHasher(() => new SHA384());
createHasher(() => new SHA512_256());
createHasher(() => new SHA512_224());
function sha256Hash(data) {
	return sha256(data);
}
function aesCbcEncrypt(data, key, iv, padding = true) {
	return cbc(key, iv, { disablePadding: !padding }).encrypt(data);
}
function aesEcbEncrypt(data, key) {
	return ecb(key, { disablePadding: true }).encrypt(data);
}
function rc4(data, key) {
	const s = /* @__PURE__ */ new Uint8Array(256);
	for (let i = 0; i < 256; i++) s[i] = i;
	let j = 0;
	for (let i = 0; i < 256; i++) {
		j = j + s[i] + key[i % key.length] & 255;
		[s[i], s[j]] = [s[j], s[i]];
	}
	const output = new Uint8Array(data.length);
	for (let i = 0, j = 0, k = 0; k < data.length; k++) {
		i = i + 1 & 255;
		j = j + s[i] & 255;
		[s[i], s[j]] = [s[j], s[i]];
		output[k] = data[k] ^ s[s[i] + s[j] & 255];
	}
	return output;
}
function randomBytes(length) {
	const bytes = new Uint8Array(length);
	globalThis.crypto.getRandomValues(bytes);
	return bytes;
}
function inRange(value, rangeGroup) {
	if (value < rangeGroup[0]) return false;
	let startRange = 0;
	let endRange = rangeGroup.length / 2;
	while (startRange <= endRange) {
		const middleRange = Math.floor((startRange + endRange) / 2);
		const arrayIndex = middleRange * 2;
		if (value >= rangeGroup[arrayIndex] && value <= rangeGroup[arrayIndex + 1]) return true;
		if (value > rangeGroup[arrayIndex + 1]) startRange = middleRange + 1;
		else endRange = middleRange - 1;
	}
	return false;
}
const unassigned_code_points = [
	545,
	545,
	564,
	591,
	686,
	687,
	751,
	767,
	848,
	863,
	880,
	883,
	886,
	889,
	891,
	893,
	895,
	899,
	907,
	907,
	909,
	909,
	930,
	930,
	975,
	975,
	1015,
	1023,
	1159,
	1159,
	1231,
	1231,
	1270,
	1271,
	1274,
	1279,
	1296,
	1328,
	1367,
	1368,
	1376,
	1376,
	1416,
	1416,
	1419,
	1424,
	1442,
	1442,
	1466,
	1466,
	1477,
	1487,
	1515,
	1519,
	1525,
	1547,
	1549,
	1562,
	1564,
	1566,
	1568,
	1568,
	1595,
	1599,
	1622,
	1631,
	1774,
	1775,
	1791,
	1791,
	1806,
	1806,
	1837,
	1839,
	1867,
	1919,
	1970,
	2304,
	2308,
	2308,
	2362,
	2363,
	2382,
	2383,
	2389,
	2391,
	2417,
	2432,
	2436,
	2436,
	2445,
	2446,
	2449,
	2450,
	2473,
	2473,
	2481,
	2481,
	2483,
	2485,
	2490,
	2491,
	2493,
	2493,
	2501,
	2502,
	2505,
	2506,
	2510,
	2518,
	2520,
	2523,
	2526,
	2526,
	2532,
	2533,
	2555,
	2561,
	2563,
	2564,
	2571,
	2574,
	2577,
	2578,
	2601,
	2601,
	2609,
	2609,
	2612,
	2612,
	2615,
	2615,
	2618,
	2619,
	2621,
	2621,
	2627,
	2630,
	2633,
	2634,
	2638,
	2648,
	2653,
	2653,
	2655,
	2661,
	2677,
	2688,
	2692,
	2692,
	2700,
	2700,
	2702,
	2702,
	2706,
	2706,
	2729,
	2729,
	2737,
	2737,
	2740,
	2740,
	2746,
	2747,
	2758,
	2758,
	2762,
	2762,
	2766,
	2767,
	2769,
	2783,
	2785,
	2789,
	2800,
	2816,
	2820,
	2820,
	2829,
	2830,
	2833,
	2834,
	2857,
	2857,
	2865,
	2865,
	2868,
	2869,
	2874,
	2875,
	2884,
	2886,
	2889,
	2890,
	2894,
	2901,
	2904,
	2907,
	2910,
	2910,
	2914,
	2917,
	2929,
	2945,
	2948,
	2948,
	2955,
	2957,
	2961,
	2961,
	2966,
	2968,
	2971,
	2971,
	2973,
	2973,
	2976,
	2978,
	2981,
	2983,
	2987,
	2989,
	2998,
	2998,
	3002,
	3005,
	3011,
	3013,
	3017,
	3017,
	3022,
	3030,
	3032,
	3046,
	3059,
	3072,
	3076,
	3076,
	3085,
	3085,
	3089,
	3089,
	3113,
	3113,
	3124,
	3124,
	3130,
	3133,
	3141,
	3141,
	3145,
	3145,
	3150,
	3156,
	3159,
	3167,
	3170,
	3173,
	3184,
	3201,
	3204,
	3204,
	3213,
	3213,
	3217,
	3217,
	3241,
	3241,
	3252,
	3252,
	3258,
	3261,
	3269,
	3269,
	3273,
	3273,
	3278,
	3284,
	3287,
	3293,
	3295,
	3295,
	3298,
	3301,
	3312,
	3329,
	3332,
	3332,
	3341,
	3341,
	3345,
	3345,
	3369,
	3369,
	3386,
	3389,
	3396,
	3397,
	3401,
	3401,
	3406,
	3414,
	3416,
	3423,
	3426,
	3429,
	3440,
	3457,
	3460,
	3460,
	3479,
	3481,
	3506,
	3506,
	3516,
	3516,
	3518,
	3519,
	3527,
	3529,
	3531,
	3534,
	3541,
	3541,
	3543,
	3543,
	3552,
	3569,
	3573,
	3584,
	3643,
	3646,
	3676,
	3712,
	3715,
	3715,
	3717,
	3718,
	3721,
	3721,
	3723,
	3724,
	3726,
	3731,
	3736,
	3736,
	3744,
	3744,
	3748,
	3748,
	3750,
	3750,
	3752,
	3753,
	3756,
	3756,
	3770,
	3770,
	3774,
	3775,
	3781,
	3781,
	3783,
	3783,
	3790,
	3791,
	3802,
	3803,
	3806,
	3839,
	3912,
	3912,
	3947,
	3952,
	3980,
	3983,
	3992,
	3992,
	4029,
	4029,
	4045,
	4046,
	4048,
	4095,
	4130,
	4130,
	4136,
	4136,
	4139,
	4139,
	4147,
	4149,
	4154,
	4159,
	4186,
	4255,
	4294,
	4303,
	4345,
	4346,
	4348,
	4351,
	4442,
	4446,
	4515,
	4519,
	4602,
	4607,
	4615,
	4615,
	4679,
	4679,
	4681,
	4681,
	4686,
	4687,
	4695,
	4695,
	4697,
	4697,
	4702,
	4703,
	4743,
	4743,
	4745,
	4745,
	4750,
	4751,
	4783,
	4783,
	4785,
	4785,
	4790,
	4791,
	4799,
	4799,
	4801,
	4801,
	4806,
	4807,
	4815,
	4815,
	4823,
	4823,
	4847,
	4847,
	4879,
	4879,
	4881,
	4881,
	4886,
	4887,
	4895,
	4895,
	4935,
	4935,
	4955,
	4960,
	4989,
	5023,
	5109,
	5120,
	5751,
	5759,
	5789,
	5791,
	5873,
	5887,
	5901,
	5901,
	5909,
	5919,
	5943,
	5951,
	5972,
	5983,
	5997,
	5997,
	6001,
	6001,
	6004,
	6015,
	6109,
	6111,
	6122,
	6143,
	6159,
	6159,
	6170,
	6175,
	6264,
	6271,
	6314,
	7679,
	7836,
	7839,
	7930,
	7935,
	7958,
	7959,
	7966,
	7967,
	8006,
	8007,
	8014,
	8015,
	8024,
	8024,
	8026,
	8026,
	8028,
	8028,
	8030,
	8030,
	8062,
	8063,
	8117,
	8117,
	8133,
	8133,
	8148,
	8149,
	8156,
	8156,
	8176,
	8177,
	8181,
	8181,
	8191,
	8191,
	8275,
	8278,
	8280,
	8286,
	8292,
	8297,
	8306,
	8307,
	8335,
	8351,
	8370,
	8399,
	8427,
	8447,
	8507,
	8508,
	8524,
	8530,
	8580,
	8591,
	9167,
	9215,
	9255,
	9279,
	9291,
	9311,
	9471,
	9471,
	9748,
	9749,
	9752,
	9752,
	9854,
	9855,
	9866,
	9984,
	9989,
	9989,
	9994,
	9995,
	10024,
	10024,
	10060,
	10060,
	10062,
	10062,
	10067,
	10069,
	10071,
	10071,
	10079,
	10080,
	10133,
	10135,
	10160,
	10160,
	10175,
	10191,
	10220,
	10223,
	11008,
	11903,
	11930,
	11930,
	12020,
	12031,
	12246,
	12271,
	12284,
	12287,
	12352,
	12352,
	12439,
	12440,
	12544,
	12548,
	12589,
	12592,
	12687,
	12687,
	12728,
	12783,
	12829,
	12831,
	12868,
	12880,
	12924,
	12926,
	13004,
	13007,
	13055,
	13055,
	13175,
	13178,
	13278,
	13279,
	13311,
	13311,
	19894,
	19967,
	40870,
	40959,
	42125,
	42127,
	42183,
	44031,
	55204,
	55295,
	64046,
	64047,
	64107,
	64255,
	64263,
	64274,
	64280,
	64284,
	64311,
	64311,
	64317,
	64317,
	64319,
	64319,
	64322,
	64322,
	64325,
	64325,
	64434,
	64466,
	64832,
	64847,
	64912,
	64913,
	64968,
	64975,
	65021,
	65023,
	65040,
	65055,
	65060,
	65071,
	65095,
	65096,
	65107,
	65107,
	65127,
	65127,
	65132,
	65135,
	65141,
	65141,
	65277,
	65278,
	65280,
	65280,
	65471,
	65473,
	65480,
	65481,
	65488,
	65489,
	65496,
	65497,
	65501,
	65503,
	65511,
	65511,
	65519,
	65528,
	65536,
	66303,
	66335,
	66335,
	66340,
	66351,
	66379,
	66559,
	66598,
	66599,
	66638,
	118783,
	119030,
	119039,
	119079,
	119081,
	119262,
	119807,
	119893,
	119893,
	119965,
	119965,
	119968,
	119969,
	119971,
	119972,
	119975,
	119976,
	119981,
	119981,
	119994,
	119994,
	119996,
	119996,
	120001,
	120001,
	120004,
	120004,
	120070,
	120070,
	120075,
	120076,
	120085,
	120085,
	120093,
	120093,
	120122,
	120122,
	120127,
	120127,
	120133,
	120133,
	120135,
	120137,
	120145,
	120145,
	120484,
	120487,
	120778,
	120781,
	120832,
	131069,
	173783,
	194559,
	195102,
	196605,
	196608,
	262141,
	262144,
	327677,
	327680,
	393213,
	393216,
	458749,
	458752,
	524285,
	524288,
	589821,
	589824,
	655357,
	655360,
	720893,
	720896,
	786429,
	786432,
	851965,
	851968,
	917501,
	917504,
	917504,
	917506,
	917535,
	917632,
	983037
];
const isUnassignedCodePoint = (character) => inRange(character, unassigned_code_points);
const commonly_mapped_to_nothing = [
	173,
	173,
	847,
	847,
	6150,
	6150,
	6155,
	6155,
	6156,
	6156,
	6157,
	6157,
	8203,
	8203,
	8204,
	8204,
	8205,
	8205,
	8288,
	8288,
	65024,
	65024,
	65025,
	65025,
	65026,
	65026,
	65027,
	65027,
	65028,
	65028,
	65029,
	65029,
	65030,
	65030,
	65031,
	65031,
	65032,
	65032,
	65033,
	65033,
	65034,
	65034,
	65035,
	65035,
	65036,
	65036,
	65037,
	65037,
	65038,
	65038,
	65039,
	65039,
	65279,
	65279
];
const isCommonlyMappedToNothing = (character) => inRange(character, commonly_mapped_to_nothing);
const non_ASCII_space_characters = [
	160,
	160,
	5760,
	5760,
	8192,
	8192,
	8193,
	8193,
	8194,
	8194,
	8195,
	8195,
	8196,
	8196,
	8197,
	8197,
	8198,
	8198,
	8199,
	8199,
	8200,
	8200,
	8201,
	8201,
	8202,
	8202,
	8203,
	8203,
	8239,
	8239,
	8287,
	8287,
	12288,
	12288
];
const isNonASCIISpaceCharacter = (character) => inRange(character, non_ASCII_space_characters);
const non_ASCII_controls_characters = [
	128,
	159,
	1757,
	1757,
	1807,
	1807,
	6158,
	6158,
	8204,
	8204,
	8205,
	8205,
	8232,
	8232,
	8233,
	8233,
	8288,
	8288,
	8289,
	8289,
	8290,
	8290,
	8291,
	8291,
	8298,
	8303,
	65279,
	65279,
	65529,
	65532,
	119155,
	119162
];
const non_character_codepoints = [
	64976,
	65007,
	65534,
	65535,
	131070,
	131071,
	196606,
	196607,
	262142,
	262143,
	327678,
	327679,
	393214,
	393215,
	458750,
	458751,
	524286,
	524287,
	589822,
	589823,
	655358,
	655359,
	720894,
	720895,
	786430,
	786431,
	851966,
	851967,
	917502,
	917503,
	983038,
	983039,
	1114110,
	1114111
];
const prohibited_characters = [
	0,
	31,
	127,
	127,
	832,
	832,
	833,
	833,
	8206,
	8206,
	8207,
	8207,
	8234,
	8234,
	8235,
	8235,
	8236,
	8236,
	8237,
	8237,
	8238,
	8238,
	8298,
	8298,
	8299,
	8299,
	8300,
	8300,
	8301,
	8301,
	8302,
	8302,
	8303,
	8303,
	12272,
	12283,
	55296,
	57343,
	57344,
	63743,
	65529,
	65529,
	65530,
	65530,
	65531,
	65531,
	65532,
	65532,
	65533,
	65533,
	917505,
	917505,
	917536,
	917631,
	983040,
	1048573,
	1048576,
	1114109
];
const isProhibitedCharacter = (character) => inRange(character, non_ASCII_space_characters) || inRange(character, prohibited_characters) || inRange(character, non_ASCII_controls_characters) || inRange(character, non_character_codepoints);
const bidirectional_r_al = [
	1470,
	1470,
	1472,
	1472,
	1475,
	1475,
	1488,
	1514,
	1520,
	1524,
	1563,
	1563,
	1567,
	1567,
	1569,
	1594,
	1600,
	1610,
	1645,
	1647,
	1649,
	1749,
	1757,
	1757,
	1765,
	1766,
	1786,
	1790,
	1792,
	1805,
	1808,
	1808,
	1810,
	1836,
	1920,
	1957,
	1969,
	1969,
	8207,
	8207,
	64285,
	64285,
	64287,
	64296,
	64298,
	64310,
	64312,
	64316,
	64318,
	64318,
	64320,
	64321,
	64323,
	64324,
	64326,
	64433,
	64467,
	64829,
	64848,
	64911,
	64914,
	64967,
	65008,
	65020,
	65136,
	65140,
	65142,
	65276
];
const isBidirectionalRAL = (character) => inRange(character, bidirectional_r_al);
const bidirectional_l = [
	65,
	90,
	97,
	122,
	170,
	170,
	181,
	181,
	186,
	186,
	192,
	214,
	216,
	246,
	248,
	544,
	546,
	563,
	592,
	685,
	688,
	696,
	699,
	705,
	720,
	721,
	736,
	740,
	750,
	750,
	890,
	890,
	902,
	902,
	904,
	906,
	908,
	908,
	910,
	929,
	931,
	974,
	976,
	1013,
	1024,
	1154,
	1162,
	1230,
	1232,
	1269,
	1272,
	1273,
	1280,
	1295,
	1329,
	1366,
	1369,
	1375,
	1377,
	1415,
	1417,
	1417,
	2307,
	2307,
	2309,
	2361,
	2365,
	2368,
	2377,
	2380,
	2384,
	2384,
	2392,
	2401,
	2404,
	2416,
	2434,
	2435,
	2437,
	2444,
	2447,
	2448,
	2451,
	2472,
	2474,
	2480,
	2482,
	2482,
	2486,
	2489,
	2494,
	2496,
	2503,
	2504,
	2507,
	2508,
	2519,
	2519,
	2524,
	2525,
	2527,
	2529,
	2534,
	2545,
	2548,
	2554,
	2565,
	2570,
	2575,
	2576,
	2579,
	2600,
	2602,
	2608,
	2610,
	2611,
	2613,
	2614,
	2616,
	2617,
	2622,
	2624,
	2649,
	2652,
	2654,
	2654,
	2662,
	2671,
	2674,
	2676,
	2691,
	2691,
	2693,
	2699,
	2701,
	2701,
	2703,
	2705,
	2707,
	2728,
	2730,
	2736,
	2738,
	2739,
	2741,
	2745,
	2749,
	2752,
	2761,
	2761,
	2763,
	2764,
	2768,
	2768,
	2784,
	2784,
	2790,
	2799,
	2818,
	2819,
	2821,
	2828,
	2831,
	2832,
	2835,
	2856,
	2858,
	2864,
	2866,
	2867,
	2870,
	2873,
	2877,
	2878,
	2880,
	2880,
	2887,
	2888,
	2891,
	2892,
	2903,
	2903,
	2908,
	2909,
	2911,
	2913,
	2918,
	2928,
	2947,
	2947,
	2949,
	2954,
	2958,
	2960,
	2962,
	2965,
	2969,
	2970,
	2972,
	2972,
	2974,
	2975,
	2979,
	2980,
	2984,
	2986,
	2990,
	2997,
	2999,
	3001,
	3006,
	3007,
	3009,
	3010,
	3014,
	3016,
	3018,
	3020,
	3031,
	3031,
	3047,
	3058,
	3073,
	3075,
	3077,
	3084,
	3086,
	3088,
	3090,
	3112,
	3114,
	3123,
	3125,
	3129,
	3137,
	3140,
	3168,
	3169,
	3174,
	3183,
	3202,
	3203,
	3205,
	3212,
	3214,
	3216,
	3218,
	3240,
	3242,
	3251,
	3253,
	3257,
	3262,
	3262,
	3264,
	3268,
	3271,
	3272,
	3274,
	3275,
	3285,
	3286,
	3294,
	3294,
	3296,
	3297,
	3302,
	3311,
	3330,
	3331,
	3333,
	3340,
	3342,
	3344,
	3346,
	3368,
	3370,
	3385,
	3390,
	3392,
	3398,
	3400,
	3402,
	3404,
	3415,
	3415,
	3424,
	3425,
	3430,
	3439,
	3458,
	3459,
	3461,
	3478,
	3482,
	3505,
	3507,
	3515,
	3517,
	3517,
	3520,
	3526,
	3535,
	3537,
	3544,
	3551,
	3570,
	3572,
	3585,
	3632,
	3634,
	3635,
	3648,
	3654,
	3663,
	3675,
	3713,
	3714,
	3716,
	3716,
	3719,
	3720,
	3722,
	3722,
	3725,
	3725,
	3732,
	3735,
	3737,
	3743,
	3745,
	3747,
	3749,
	3749,
	3751,
	3751,
	3754,
	3755,
	3757,
	3760,
	3762,
	3763,
	3773,
	3773,
	3776,
	3780,
	3782,
	3782,
	3792,
	3801,
	3804,
	3805,
	3840,
	3863,
	3866,
	3892,
	3894,
	3894,
	3896,
	3896,
	3902,
	3911,
	3913,
	3946,
	3967,
	3967,
	3973,
	3973,
	3976,
	3979,
	4030,
	4037,
	4039,
	4044,
	4047,
	4047,
	4096,
	4129,
	4131,
	4135,
	4137,
	4138,
	4140,
	4140,
	4145,
	4145,
	4152,
	4152,
	4160,
	4183,
	4256,
	4293,
	4304,
	4344,
	4347,
	4347,
	4352,
	4441,
	4447,
	4514,
	4520,
	4601,
	4608,
	4614,
	4616,
	4678,
	4680,
	4680,
	4682,
	4685,
	4688,
	4694,
	4696,
	4696,
	4698,
	4701,
	4704,
	4742,
	4744,
	4744,
	4746,
	4749,
	4752,
	4782,
	4784,
	4784,
	4786,
	4789,
	4792,
	4798,
	4800,
	4800,
	4802,
	4805,
	4808,
	4814,
	4816,
	4822,
	4824,
	4846,
	4848,
	4878,
	4880,
	4880,
	4882,
	4885,
	4888,
	4894,
	4896,
	4934,
	4936,
	4954,
	4961,
	4988,
	5024,
	5108,
	5121,
	5750,
	5761,
	5786,
	5792,
	5872,
	5888,
	5900,
	5902,
	5905,
	5920,
	5937,
	5941,
	5942,
	5952,
	5969,
	5984,
	5996,
	5998,
	6e3,
	6016,
	6070,
	6078,
	6085,
	6087,
	6088,
	6100,
	6106,
	6108,
	6108,
	6112,
	6121,
	6160,
	6169,
	6176,
	6263,
	6272,
	6312,
	7680,
	7835,
	7840,
	7929,
	7936,
	7957,
	7960,
	7965,
	7968,
	8005,
	8008,
	8013,
	8016,
	8023,
	8025,
	8025,
	8027,
	8027,
	8029,
	8029,
	8031,
	8061,
	8064,
	8116,
	8118,
	8124,
	8126,
	8126,
	8130,
	8132,
	8134,
	8140,
	8144,
	8147,
	8150,
	8155,
	8160,
	8172,
	8178,
	8180,
	8182,
	8188,
	8206,
	8206,
	8305,
	8305,
	8319,
	8319,
	8450,
	8450,
	8455,
	8455,
	8458,
	8467,
	8469,
	8469,
	8473,
	8477,
	8484,
	8484,
	8486,
	8486,
	8488,
	8488,
	8490,
	8493,
	8495,
	8497,
	8499,
	8505,
	8509,
	8511,
	8517,
	8521,
	8544,
	8579,
	9014,
	9082,
	9109,
	9109,
	9372,
	9449,
	12293,
	12295,
	12321,
	12329,
	12337,
	12341,
	12344,
	12348,
	12353,
	12438,
	12445,
	12447,
	12449,
	12538,
	12540,
	12543,
	12549,
	12588,
	12593,
	12686,
	12688,
	12727,
	12784,
	12828,
	12832,
	12867,
	12896,
	12923,
	12927,
	12976,
	12992,
	13003,
	13008,
	13054,
	13056,
	13174,
	13179,
	13277,
	13280,
	13310,
	13312,
	19893,
	19968,
	40869,
	40960,
	42124,
	44032,
	55203,
	55296,
	64045,
	64048,
	64106,
	64256,
	64262,
	64275,
	64279,
	65313,
	65338,
	65345,
	65370,
	65382,
	65470,
	65474,
	65479,
	65482,
	65487,
	65490,
	65495,
	65498,
	65500,
	66304,
	66334,
	66336,
	66339,
	66352,
	66378,
	66560,
	66597,
	66600,
	66637,
	118784,
	119029,
	119040,
	119078,
	119082,
	119142,
	119146,
	119154,
	119171,
	119172,
	119180,
	119209,
	119214,
	119261,
	119808,
	119892,
	119894,
	119964,
	119966,
	119967,
	119970,
	119970,
	119973,
	119974,
	119977,
	119980,
	119982,
	119993,
	119995,
	119995,
	119997,
	12e4,
	120002,
	120003,
	120005,
	120069,
	120071,
	120074,
	120077,
	120084,
	120086,
	120092,
	120094,
	120121,
	120123,
	120126,
	120128,
	120132,
	120134,
	120134,
	120138,
	120144,
	120146,
	120483,
	120488,
	120777,
	131072,
	173782,
	194560,
	195101,
	983040,
	1048573,
	1048576,
	1114109
];
const isBidirectionalL = (character) => inRange(character, bidirectional_l);
const mapping2space = isNonASCIISpaceCharacter;
const mapping2nothing = isCommonlyMappedToNothing;
const getCodePoint = (character) => character.codePointAt(0);
const first = (x) => x[0];
const last = (x) => x[x.length - 1];
function toCodePoints(input) {
	const codepoints = [];
	const size = input.length;
	for (let i = 0; i < size; i += 1) {
		const before = input.charCodeAt(i);
		if (before >= 55296 && before <= 56319 && size > i + 1) {
			const next = input.charCodeAt(i + 1);
			if (next >= 56320 && next <= 57343) {
				codepoints.push((before - 55296) * 1024 + next - 56320 + 65536);
				i += 1;
				continue;
			}
		}
		codepoints.push(before);
	}
	return codepoints;
}
function saslprep(input, opts = {}) {
	if (typeof input !== "string") throw new TypeError("Expected string.");
	if (input.length === 0) return "";
	const mapped_input = toCodePoints(input).map((character) => mapping2space(character) ? 32 : character).filter((character) => !mapping2nothing(character));
	const normalized_input = String.fromCodePoint.apply(null, mapped_input).normalize("NFKC");
	const normalized_map = toCodePoints(normalized_input);
	if (normalized_map.some(isProhibitedCharacter)) throw new Error("Prohibited character, see https://tools.ietf.org/html/rfc4013#section-2.3");
	if (opts.allowUnassigned !== true) {
		if (normalized_map.some(isUnassignedCodePoint)) throw new Error("Unassigned code point, see https://tools.ietf.org/html/rfc4013#section-2.5");
	}
	const hasBidiRAL = normalized_map.some(isBidirectionalRAL);
	const hasBidiL = normalized_map.some(isBidirectionalL);
	if (hasBidiRAL && hasBidiL) throw new Error("String must not contain RandALCat and LCat at the same time, see https://tools.ietf.org/html/rfc3454#section-6");
	const isFirstBidiRAL = isBidirectionalRAL(getCodePoint(first(normalized_input)));
	const isLastBidiRAL = isBidirectionalRAL(getCodePoint(last(normalized_input)));
	if (hasBidiRAL && !(isFirstBidiRAL && isLastBidiRAL)) throw new Error("Bidirectional RandALCat character must be the first and the last character of the string, see https://tools.ietf.org/html/rfc3454#section-6");
	return normalized_input;
}
var PDFSecurity = class PDFSecurity {
	static generateFileID(info = {}) {
		let infoStr = `${info.CreationDate.getTime()}\n`;
		for (let key in info) {
			if (!info.hasOwnProperty(key)) continue;
			infoStr += `${key}: ${info[key].valueOf()}\n`;
		}
		return md5Hash(infoStr);
	}
	static generateRandomWordArray(bytes) {
		return randomBytes(bytes);
	}
	static create(document, options = {}) {
		if (!options.ownerPassword && !options.userPassword) return null;
		return new PDFSecurity(document, options);
	}
	constructor(document, options = {}) {
		if (!options.ownerPassword && !options.userPassword) throw new Error("None of owner password and user password is defined.");
		this.document = document;
		this._setupEncryption(options);
	}
	_setupEncryption(options) {
		switch (options.pdfVersion) {
			case "1.4":
			case "1.5":
				this.version = 2;
				break;
			case "1.6":
			case "1.7":
				this.version = 4;
				break;
			case "1.7ext3":
				this.version = 5;
				break;
			default: this.version = 1;
		}
		const encDict = { Filter: "Standard" };
		switch (this.version) {
			case 1:
			case 2:
			case 4:
				this._setupEncryptionV1V2V4(this.version, encDict, options);
				break;
			case 5: this._setupEncryptionV5(encDict, options);
		}
		this.dictionary = this.document.ref(encDict);
	}
	_setupEncryptionV1V2V4(v, encDict, options) {
		let r, permissions;
		switch (v) {
			case 1:
				r = 2;
				this.keyBits = 40;
				permissions = getPermissionsR2(options.permissions);
				break;
			case 2:
				r = 3;
				this.keyBits = 128;
				permissions = getPermissionsR3(options.permissions);
				break;
			case 4:
				r = 4;
				this.keyBits = 128;
				permissions = getPermissionsR3(options.permissions);
		}
		const paddedUserPassword = processPasswordR2R3R4(options.userPassword);
		const paddedOwnerPassword = options.ownerPassword ? processPasswordR2R3R4(options.ownerPassword) : paddedUserPassword;
		const ownerPasswordEntry = getOwnerPasswordR2R3R4(r, this.keyBits, paddedUserPassword, paddedOwnerPassword);
		this.encryptionKey = getEncryptionKeyR2R3R4(r, this.keyBits, this.document._id, paddedUserPassword, ownerPasswordEntry, permissions);
		let userPasswordEntry;
		if (r === 2) userPasswordEntry = getUserPasswordR2(this.encryptionKey);
		else userPasswordEntry = getUserPasswordR3R4(this.document._id, this.encryptionKey);
		encDict.V = v;
		if (v >= 2) encDict.Length = this.keyBits;
		if (v === 4) {
			encDict.CF = { StdCF: {
				AuthEvent: "DocOpen",
				CFM: "AESV2",
				Length: this.keyBits / 8
			} };
			encDict.StmF = "StdCF";
			encDict.StrF = "StdCF";
		}
		encDict.R = r;
		encDict.O = ownerPasswordEntry;
		encDict.U = userPasswordEntry;
		encDict.P = permissions;
	}
	_setupEncryptionV5(encDict, options) {
		this.keyBits = 256;
		const permissions = getPermissionsR3(options.permissions);
		const processedUserPassword = processPasswordR5(options.userPassword);
		const processedOwnerPassword = options.ownerPassword ? processPasswordR5(options.ownerPassword) : processedUserPassword;
		this.encryptionKey = getEncryptionKeyR5(PDFSecurity.generateRandomWordArray);
		const userPasswordEntry = getUserPasswordR5(processedUserPassword, PDFSecurity.generateRandomWordArray);
		const userEncryptionKeyEntry = getUserEncryptionKeyR5(processedUserPassword, userPasswordEntry.slice(40, 48), this.encryptionKey);
		const ownerPasswordEntry = getOwnerPasswordR5(processedOwnerPassword, userPasswordEntry, PDFSecurity.generateRandomWordArray);
		const ownerEncryptionKeyEntry = getOwnerEncryptionKeyR5(processedOwnerPassword, ownerPasswordEntry.slice(40, 48), userPasswordEntry, this.encryptionKey);
		const permsEntry = getEncryptedPermissionsR5(permissions, this.encryptionKey, PDFSecurity.generateRandomWordArray);
		encDict.V = 5;
		encDict.Length = this.keyBits;
		encDict.CF = { StdCF: {
			AuthEvent: "DocOpen",
			CFM: "AESV3",
			Length: this.keyBits / 8
		} };
		encDict.StmF = "StdCF";
		encDict.StrF = "StdCF";
		encDict.R = 5;
		encDict.O = ownerPasswordEntry;
		encDict.OE = ownerEncryptionKeyEntry;
		encDict.U = userPasswordEntry;
		encDict.UE = userEncryptionKeyEntry;
		encDict.P = permissions;
		encDict.Perms = permsEntry;
	}
	getEncryptFn(obj, gen) {
		let digest;
		if (this.version < 5) {
			const suffix = new Uint8Array([
				obj & 255,
				obj >> 8 & 255,
				obj >> 16 & 255,
				gen & 255,
				gen >> 8 & 255
			]);
			digest = concatBytes(this.encryptionKey, suffix);
		}
		if (this.version === 1 || this.version === 2) {
			let key = md5Hash(digest);
			const keyLen = Math.min(16, this.keyBits / 8 + 5);
			key = key.slice(0, keyLen);
			return (buffer) => rc4(buffer, key);
		}
		let key;
		if (this.version === 4) {
			const saltMarker = new Uint8Array([
				115,
				65,
				108,
				84
			]);
			key = md5Hash(concatBytes(digest, saltMarker));
		} else key = this.encryptionKey;
		const iv = PDFSecurity.generateRandomWordArray(16);
		return (buffer) => {
			const encrypted = aesCbcEncrypt(buffer, key, iv, true);
			return concatBytes(iv, encrypted);
		};
	}
	end() {
		this.dictionary.end();
	}
};
function getPermissionsR2(permissionObject = {}) {
	let permissions = -64;
	if (permissionObject.printing) permissions |= 4;
	if (permissionObject.modifying) permissions |= 8;
	if (permissionObject.copying) permissions |= 16;
	if (permissionObject.annotating) permissions |= 32;
	return permissions;
}
function getPermissionsR3(permissionObject = {}) {
	let permissions = -3904;
	if (permissionObject.printing === "lowResolution") permissions |= 4;
	if (permissionObject.printing === "highResolution") permissions |= 2052;
	if (permissionObject.modifying) permissions |= 8;
	if (permissionObject.copying) permissions |= 16;
	if (permissionObject.annotating) permissions |= 32;
	if (permissionObject.fillingForms) permissions |= 256;
	if (permissionObject.contentAccessibility) permissions |= 512;
	if (permissionObject.documentAssembly) permissions |= 1024;
	return permissions;
}
function getUserPasswordR2(encryptionKey) {
	return rc4(processPasswordR2R3R4(), encryptionKey);
}
function getUserPasswordR3R4(documentId, encryptionKey) {
	const key = encryptionKey.slice();
	let cipher = md5Hash(concatBytes(processPasswordR2R3R4(), new Uint8Array(documentId)));
	for (let i = 0; i < 20; i++) {
		const xorKey = new Uint8Array(key.length);
		for (let j = 0; j < key.length; j++) xorKey[j] = encryptionKey[j] ^ i;
		cipher = rc4(cipher, xorKey);
	}
	const result = /* @__PURE__ */ new Uint8Array(32);
	result.set(cipher);
	return result;
}
function getOwnerPasswordR2R3R4(r, keyBits, paddedUserPassword, paddedOwnerPassword) {
	let digest = paddedOwnerPassword;
	let round = r >= 3 ? 51 : 1;
	for (let i = 0; i < round; i++) digest = md5Hash(digest);
	const keyLen = keyBits / 8;
	let key = digest.slice(0, keyLen);
	let cipher = paddedUserPassword;
	round = r >= 3 ? 20 : 1;
	for (let i = 0; i < round; i++) {
		const xorKey = new Uint8Array(keyLen);
		for (let j = 0; j < keyLen; j++) xorKey[j] = key[j] ^ i;
		cipher = rc4(cipher, xorKey);
	}
	return cipher;
}
function getEncryptionKeyR2R3R4(r, keyBits, documentId, paddedUserPassword, ownerPasswordEntry, permissions) {
	const permBytes = new Uint8Array([
		permissions & 255,
		permissions >> 8 & 255,
		permissions >> 16 & 255,
		permissions >> 24 & 255
	]);
	let key = concatBytes(paddedUserPassword, ownerPasswordEntry, permBytes, new Uint8Array(documentId));
	const round = r >= 3 ? 51 : 1;
	const keyLen = keyBits / 8;
	for (let i = 0; i < round; i++) {
		key = md5Hash(key);
		key = key.slice(0, keyLen);
	}
	return key;
}
function getUserPasswordR5(processedUserPassword, generateRandomWordArray) {
	const validationSalt = generateRandomWordArray(8);
	const keySalt = generateRandomWordArray(8);
	const hash = sha256Hash(concatBytes(processedUserPassword, validationSalt));
	return concatBytes(hash, validationSalt, keySalt);
}
function getUserEncryptionKeyR5(processedUserPassword, userKeySalt, encryptionKey) {
	return aesCbcEncrypt(encryptionKey, sha256Hash(concatBytes(processedUserPassword, userKeySalt)), /* @__PURE__ */ new Uint8Array(16), false);
}
function getOwnerPasswordR5(processedOwnerPassword, userPasswordEntry, generateRandomWordArray) {
	const validationSalt = generateRandomWordArray(8);
	const keySalt = generateRandomWordArray(8);
	const hash = sha256Hash(concatBytes(processedOwnerPassword, validationSalt, userPasswordEntry));
	return concatBytes(hash, validationSalt, keySalt);
}
function getOwnerEncryptionKeyR5(processedOwnerPassword, ownerKeySalt, userPasswordEntry, encryptionKey) {
	return aesCbcEncrypt(encryptionKey, sha256Hash(concatBytes(processedOwnerPassword, ownerKeySalt, userPasswordEntry)), /* @__PURE__ */ new Uint8Array(16), false);
}
function getEncryptionKeyR5(generateRandomWordArray) {
	return generateRandomWordArray(32);
}
function getEncryptedPermissionsR5(permissions, encryptionKey, generateRandomWordArray) {
	const data = /* @__PURE__ */ new Uint8Array(16);
	data[0] = permissions & 255;
	data[1] = permissions >> 8 & 255;
	data[2] = permissions >> 16 & 255;
	data[3] = permissions >> 24 & 255;
	data[4] = 255;
	data[5] = 255;
	data[6] = 255;
	data[7] = 255;
	data[8] = 84;
	data[9] = 97;
	data[10] = 100;
	data[11] = 98;
	const randomPart = generateRandomWordArray(4);
	data.set(randomPart, 12);
	return aesEcbEncrypt(data, encryptionKey);
}
function processPasswordR2R3R4(password = "") {
	const out = /* @__PURE__ */ new Uint8Array(32);
	const length = password.length;
	let index = 0;
	while (index < length && index < 32) {
		const code = password.charCodeAt(index);
		if (code > 255) throw new Error("Password contains one or more invalid characters.");
		out[index] = code;
		index++;
	}
	while (index < 32) {
		out[index] = PASSWORD_PADDING[index - length];
		index++;
	}
	return out;
}
function processPasswordR5(password = "") {
	password = unescape(encodeURIComponent(saslprep(password)));
	const length = Math.min(127, password.length);
	const out = new Uint8Array(length);
	for (let i = 0; i < length; i++) out[i] = password.charCodeAt(i);
	return out;
}
const PASSWORD_PADDING = [
	40,
	191,
	78,
	94,
	78,
	117,
	138,
	65,
	100,
	0,
	78,
	86,
	255,
	250,
	1,
	8,
	46,
	46,
	0,
	182,
	208,
	104,
	62,
	128,
	47,
	12,
	169,
	254,
	100,
	83,
	105,
	122
];
const { number: number$2 } = PDFObject;
let PDFGradient$1 = class PDFGradient {
	constructor(doc) {
		this.doc = doc;
		this.stops = [];
		this.embedded = false;
		this.transform = [
			1,
			0,
			0,
			1,
			0,
			0
		];
	}
	stop(pos, color, opacity) {
		if (opacity == null) opacity = 1;
		color = this.doc._normalizeColor(color);
		if (this.stops.length === 0) {
			if (color.length === 3) this._colorSpace = "DeviceRGB";
			else if (color.length === 4) this._colorSpace = "DeviceCMYK";
			else if (color.length === 1) this._colorSpace = "DeviceGray";
			else throw new Error("Unknown color space");
		} else if (this._colorSpace === "DeviceRGB" && color.length !== 3 || this._colorSpace === "DeviceCMYK" && color.length !== 4 || this._colorSpace === "DeviceGray" && color.length !== 1) throw new Error("All gradient stops must use the same color space");
		opacity = Math.max(0, Math.min(1, opacity));
		this.stops.push([
			pos,
			color,
			opacity
		]);
		return this;
	}
	setTransform(m11, m12, m21, m22, dx, dy) {
		this.transform = [
			m11,
			m12,
			m21,
			m22,
			dx,
			dy
		];
		return this;
	}
	embed(m) {
		let fn;
		const stopsLength = this.stops.length;
		if (stopsLength === 0) return;
		this.embedded = true;
		this.matrix = m;
		const last = this.stops[stopsLength - 1];
		if (last[0] < 1) this.stops.push([
			1,
			last[1],
			last[2]
		]);
		const bounds = [];
		const encode = [];
		const stops = [];
		for (let i = 0; i < stopsLength - 1; i++) {
			encode.push(0, 1);
			if (i + 2 !== stopsLength) bounds.push(this.stops[i + 1][0]);
			fn = this.doc.ref({
				FunctionType: 2,
				Domain: [0, 1],
				C0: this.stops[i + 0][1],
				C1: this.stops[i + 1][1],
				N: 1
			});
			stops.push(fn);
			fn.end();
		}
		if (stopsLength === 1) fn = stops[0];
		else {
			fn = this.doc.ref({
				FunctionType: 3,
				Domain: [0, 1],
				Functions: stops,
				Bounds: bounds,
				Encode: encode
			});
			fn.end();
		}
		this.id = `Sh${++this.doc._gradCount}`;
		const shader = this.shader(fn);
		shader.end();
		const pattern = this.doc.ref({
			Type: "Pattern",
			PatternType: 2,
			Shading: shader,
			Matrix: this.matrix.map(number$2)
		});
		pattern.end();
		if (this.stops.some((stop) => stop[2] < 1)) {
			let grad = this.opacityGradient();
			grad._colorSpace = "DeviceGray";
			for (let stop of this.stops) grad.stop(stop[0], [stop[2]]);
			grad = grad.embed(this.matrix);
			const pageBBox = [
				0,
				0,
				this.doc.page.width,
				this.doc.page.height
			];
			const form = this.doc.ref({
				Type: "XObject",
				Subtype: "Form",
				FormType: 1,
				BBox: pageBBox,
				Group: {
					Type: "Group",
					S: "Transparency",
					CS: "DeviceGray"
				},
				Resources: {
					ProcSet: [
						"PDF",
						"Text",
						"ImageB",
						"ImageC",
						"ImageI"
					],
					Pattern: { Sh1: grad }
				}
			});
			form.write("/Pattern cs /Sh1 scn");
			form.end(`${pageBBox.join(" ")} re f`);
			const gstate = this.doc.ref({
				Type: "ExtGState",
				SMask: {
					Type: "Mask",
					S: "Luminosity",
					G: form
				}
			});
			gstate.end();
			const opacityPattern = this.doc.ref({
				Type: "Pattern",
				PatternType: 1,
				PaintType: 1,
				TilingType: 2,
				BBox: pageBBox,
				XStep: pageBBox[2],
				YStep: pageBBox[3],
				Resources: {
					ProcSet: [
						"PDF",
						"Text",
						"ImageB",
						"ImageC",
						"ImageI"
					],
					Pattern: { Sh1: pattern },
					ExtGState: { Gs1: gstate }
				}
			});
			opacityPattern.write("/Gs1 gs /Pattern cs /Sh1 scn");
			opacityPattern.end(`${pageBBox.join(" ")} re f`);
			this.doc.page.patterns[this.id] = opacityPattern;
		} else this.doc.page.patterns[this.id] = pattern;
		return pattern;
	}
	apply(stroke) {
		const [m0, m1, m2, m3, m4, m5] = this.doc._ctm;
		const [m11, m12, m21, m22, dx, dy] = this.transform;
		const m = [
			m0 * m11 + m2 * m12,
			m1 * m11 + m3 * m12,
			m0 * m21 + m2 * m22,
			m1 * m21 + m3 * m22,
			m0 * dx + m2 * dy + m4,
			m1 * dx + m3 * dy + m5
		];
		if (!this.embedded || m.join(" ") !== this.matrix.join(" ")) this.embed(m);
		this.doc._setColorSpace("Pattern", stroke);
		const op = stroke ? "SCN" : "scn";
		return this.doc.addContent(`/${this.id} ${op}`);
	}
};
var Gradient = {
	PDFGradient: PDFGradient$1,
	PDFLinearGradient: class PDFLinearGradient extends PDFGradient$1 {
		constructor(doc, x1, y1, x2, y2) {
			super(doc);
			this.x1 = x1;
			this.y1 = y1;
			this.x2 = x2;
			this.y2 = y2;
		}
		shader(fn) {
			return this.doc.ref({
				ShadingType: 2,
				ColorSpace: this._colorSpace,
				Coords: [
					this.x1,
					this.y1,
					this.x2,
					this.y2
				],
				Function: fn,
				Extend: [true, true]
			});
		}
		opacityGradient() {
			return new PDFLinearGradient(this.doc, this.x1, this.y1, this.x2, this.y2);
		}
	},
	PDFRadialGradient: class PDFRadialGradient extends PDFGradient$1 {
		constructor(doc, x1, y1, r1, x2, y2, r2) {
			super(doc);
			this.doc = doc;
			this.x1 = x1;
			this.y1 = y1;
			this.r1 = r1;
			this.x2 = x2;
			this.y2 = y2;
			this.r2 = r2;
		}
		shader(fn) {
			return this.doc.ref({
				ShadingType: 3,
				ColorSpace: this._colorSpace,
				Coords: [
					this.x1,
					this.y1,
					this.r1,
					this.x2,
					this.y2,
					this.r2
				],
				Function: fn,
				Extend: [true, true]
			});
		}
		opacityGradient() {
			return new PDFRadialGradient(this.doc, this.x1, this.y1, this.r1, this.x2, this.y2, this.r2);
		}
	}
};
const underlyingColorSpaces = ["DeviceCMYK", "DeviceRGB"];
var pattern = { PDFTilingPattern: class PDFTilingPattern {
	constructor(doc, bBox, xStep, yStep, stream) {
		this.doc = doc;
		this.bBox = bBox;
		this.xStep = xStep;
		this.yStep = yStep;
		this.stream = stream;
	}
	createPattern() {
		const resources = this.doc.ref();
		resources.end();
		const [m0, m1, m2, m3, m4, m5] = this.doc._ctm;
		const [m11, m12, m21, m22, dx, dy] = [
			1,
			0,
			0,
			1,
			0,
			0
		];
		const m = [
			m0 * m11 + m2 * m12,
			m1 * m11 + m3 * m12,
			m0 * m21 + m2 * m22,
			m1 * m21 + m3 * m22,
			m0 * dx + m2 * dy + m4,
			m1 * dx + m3 * dy + m5
		];
		const pattern = this.doc.ref({
			Type: "Pattern",
			PatternType: 1,
			PaintType: 2,
			TilingType: 2,
			BBox: this.bBox,
			XStep: this.xStep,
			YStep: this.yStep,
			Matrix: m.map((v) => +v.toFixed(5)),
			Resources: resources
		});
		pattern.end(this.stream);
		return pattern;
	}
	embedPatternColorSpaces() {
		underlyingColorSpaces.forEach((csName) => {
			const csId = this.getPatternColorSpaceId(csName);
			if (this.doc.page.colorSpaces[csId]) return;
			const cs = this.doc.ref(["Pattern", csName]);
			cs.end();
			this.doc.page.colorSpaces[csId] = cs;
		});
	}
	getPatternColorSpaceId(underlyingColorspace) {
		return `CsP${underlyingColorspace}`;
	}
	embed() {
		if (!this.id) {
			this.doc._patternCount = this.doc._patternCount + 1;
			this.id = "P" + this.doc._patternCount;
			this.pattern = this.createPattern();
		}
		if (!this.doc.page.patterns[this.id]) this.doc.page.patterns[this.id] = this.pattern;
	}
	apply(stroke, patternColor) {
		this.embedPatternColorSpaces();
		this.embed();
		const normalizedColor = this.doc._normalizeColor(patternColor);
		if (!normalizedColor) throw Error(`invalid pattern color. (value: ${patternColor})`);
		const csId = this.getPatternColorSpaceId(this.doc._getColorSpace(normalizedColor));
		this.doc._setColorSpace(csId, stroke);
		const op = stroke ? "SCN" : "scn";
		return this.doc.addContent(`${normalizedColor.join(" ")} /${this.id} ${op}`);
	}
} };
const { PDFGradient, PDFLinearGradient, PDFRadialGradient } = Gradient;
const { PDFTilingPattern } = pattern;
var ColorMixin = {
	initColor() {
		this.spotColors = {};
		this._opacityRegistry = {};
		this._opacityCount = 0;
		this._patternCount = 0;
		this._gradCount = 0;
	},
	_normalizeColor(color) {
		if (typeof color === "string") {
			if (color.charAt(0) === "#") {
				if (color.length === 4) color = color.replace(/#([0-9A-F])([0-9A-F])([0-9A-F])/i, "#$1$1$2$2$3$3");
				const hex = parseInt(color.slice(1), 16);
				color = [
					hex >> 16,
					hex >> 8 & 255,
					hex & 255
				];
			} else if (namedColors[color.toLowerCase()]) color = namedColors[color.toLowerCase()];
			else if (this.spotColors[color]) return this.spotColors[color];
		}
		if (Array.isArray(color)) {
			if (color.length === 3) color = color.map((part) => part / 255);
			else if (color.length === 4) color = color.map((part) => part / 100);
			return color;
		}
		return null;
	},
	_setColor(color, stroke) {
		if (color instanceof PDFGradient) {
			color.apply(stroke);
			return true;
		} else if (Array.isArray(color) && color[0] instanceof PDFTilingPattern) {
			color[0].apply(stroke, color[1]);
			return true;
		}
		return this._setColorCore(color, stroke);
	},
	_setColorCore(color, stroke) {
		color = this._normalizeColor(color);
		if (!color) return false;
		const op = stroke ? "SCN" : "scn";
		const space = this._getColorSpace(color);
		this._setColorSpace(space, stroke);
		if (color instanceof SpotColor) {
			this.page.colorSpaces[color.id] = color.ref;
			this.addContent(`1 ${op}`);
		} else this.addContent(`${color.join(" ")} ${op}`);
		return true;
	},
	_setColorSpace(space, stroke) {
		const op = stroke ? "CS" : "cs";
		return this.addContent(`/${space} ${op}`);
	},
	_getColorSpace(color) {
		if (color instanceof SpotColor) return color.id;
		return color.length === 4 ? "DeviceCMYK" : "DeviceRGB";
	},
	fillColor(color, opacity) {
		if (this._setColor(color, false)) this.fillOpacity(opacity);
		this._fillColor = [color, opacity];
		return this;
	},
	strokeColor(color, opacity) {
		if (this._setColor(color, true)) this.strokeOpacity(opacity);
		return this;
	},
	opacity(opacity) {
		this._doOpacity(opacity, opacity);
		return this;
	},
	fillOpacity(opacity) {
		this._doOpacity(opacity, null);
		return this;
	},
	strokeOpacity(opacity) {
		this._doOpacity(null, opacity);
		return this;
	},
	_doOpacity(fillOpacity, strokeOpacity) {
		let dictionary, name;
		if (fillOpacity == null && strokeOpacity == null) return;
		if (fillOpacity != null) fillOpacity = Math.max(0, Math.min(1, fillOpacity));
		if (strokeOpacity != null) strokeOpacity = Math.max(0, Math.min(1, strokeOpacity));
		const key = `${fillOpacity}_${strokeOpacity}`;
		if (this._opacityRegistry[key]) [dictionary, name] = this._opacityRegistry[key];
		else {
			dictionary = { Type: "ExtGState" };
			if (fillOpacity != null) dictionary.ca = fillOpacity;
			if (strokeOpacity != null) dictionary.CA = strokeOpacity;
			dictionary = this.ref(dictionary);
			dictionary.end();
			name = `Gs${++this._opacityCount}`;
			this._opacityRegistry[key] = [dictionary, name];
		}
		this.page.ext_gstates[name] = dictionary;
		return this.addContent(`/${name} gs`);
	},
	linearGradient(x1, y1, x2, y2) {
		return new PDFLinearGradient(this, x1, y1, x2, y2);
	},
	radialGradient(x1, y1, r1, x2, y2, r2) {
		return new PDFRadialGradient(this, x1, y1, r1, x2, y2, r2);
	},
	pattern(bbox, xStep, yStep, stream) {
		return new PDFTilingPattern(this, bbox, xStep, yStep, stream);
	},
	addSpotColor(name, C, M, Y, K) {
		const color = new SpotColor(this, name, C, M, Y, K);
		this.spotColors[name] = color;
		return this;
	}
};
var namedColors = {
	aliceblue: [
		240,
		248,
		255
	],
	antiquewhite: [
		250,
		235,
		215
	],
	aqua: [
		0,
		255,
		255
	],
	aquamarine: [
		127,
		255,
		212
	],
	azure: [
		240,
		255,
		255
	],
	beige: [
		245,
		245,
		220
	],
	bisque: [
		255,
		228,
		196
	],
	black: [
		0,
		0,
		0
	],
	blanchedalmond: [
		255,
		235,
		205
	],
	blue: [
		0,
		0,
		255
	],
	blueviolet: [
		138,
		43,
		226
	],
	brown: [
		165,
		42,
		42
	],
	burlywood: [
		222,
		184,
		135
	],
	cadetblue: [
		95,
		158,
		160
	],
	chartreuse: [
		127,
		255,
		0
	],
	chocolate: [
		210,
		105,
		30
	],
	coral: [
		255,
		127,
		80
	],
	cornflowerblue: [
		100,
		149,
		237
	],
	cornsilk: [
		255,
		248,
		220
	],
	crimson: [
		220,
		20,
		60
	],
	cyan: [
		0,
		255,
		255
	],
	darkblue: [
		0,
		0,
		139
	],
	darkcyan: [
		0,
		139,
		139
	],
	darkgoldenrod: [
		184,
		134,
		11
	],
	darkgray: [
		169,
		169,
		169
	],
	darkgreen: [
		0,
		100,
		0
	],
	darkgrey: [
		169,
		169,
		169
	],
	darkkhaki: [
		189,
		183,
		107
	],
	darkmagenta: [
		139,
		0,
		139
	],
	darkolivegreen: [
		85,
		107,
		47
	],
	darkorange: [
		255,
		140,
		0
	],
	darkorchid: [
		153,
		50,
		204
	],
	darkred: [
		139,
		0,
		0
	],
	darksalmon: [
		233,
		150,
		122
	],
	darkseagreen: [
		143,
		188,
		143
	],
	darkslateblue: [
		72,
		61,
		139
	],
	darkslategray: [
		47,
		79,
		79
	],
	darkslategrey: [
		47,
		79,
		79
	],
	darkturquoise: [
		0,
		206,
		209
	],
	darkviolet: [
		148,
		0,
		211
	],
	deeppink: [
		255,
		20,
		147
	],
	deepskyblue: [
		0,
		191,
		255
	],
	dimgray: [
		105,
		105,
		105
	],
	dimgrey: [
		105,
		105,
		105
	],
	dodgerblue: [
		30,
		144,
		255
	],
	firebrick: [
		178,
		34,
		34
	],
	floralwhite: [
		255,
		250,
		240
	],
	forestgreen: [
		34,
		139,
		34
	],
	fuchsia: [
		255,
		0,
		255
	],
	gainsboro: [
		220,
		220,
		220
	],
	ghostwhite: [
		248,
		248,
		255
	],
	gold: [
		255,
		215,
		0
	],
	goldenrod: [
		218,
		165,
		32
	],
	gray: [
		128,
		128,
		128
	],
	grey: [
		128,
		128,
		128
	],
	green: [
		0,
		128,
		0
	],
	greenyellow: [
		173,
		255,
		47
	],
	honeydew: [
		240,
		255,
		240
	],
	hotpink: [
		255,
		105,
		180
	],
	indianred: [
		205,
		92,
		92
	],
	indigo: [
		75,
		0,
		130
	],
	ivory: [
		255,
		255,
		240
	],
	khaki: [
		240,
		230,
		140
	],
	lavender: [
		230,
		230,
		250
	],
	lavenderblush: [
		255,
		240,
		245
	],
	lawngreen: [
		124,
		252,
		0
	],
	lemonchiffon: [
		255,
		250,
		205
	],
	lightblue: [
		173,
		216,
		230
	],
	lightcoral: [
		240,
		128,
		128
	],
	lightcyan: [
		224,
		255,
		255
	],
	lightgoldenrodyellow: [
		250,
		250,
		210
	],
	lightgray: [
		211,
		211,
		211
	],
	lightgreen: [
		144,
		238,
		144
	],
	lightgrey: [
		211,
		211,
		211
	],
	lightpink: [
		255,
		182,
		193
	],
	lightsalmon: [
		255,
		160,
		122
	],
	lightseagreen: [
		32,
		178,
		170
	],
	lightskyblue: [
		135,
		206,
		250
	],
	lightslategray: [
		119,
		136,
		153
	],
	lightslategrey: [
		119,
		136,
		153
	],
	lightsteelblue: [
		176,
		196,
		222
	],
	lightyellow: [
		255,
		255,
		224
	],
	lime: [
		0,
		255,
		0
	],
	limegreen: [
		50,
		205,
		50
	],
	linen: [
		250,
		240,
		230
	],
	magenta: [
		255,
		0,
		255
	],
	maroon: [
		128,
		0,
		0
	],
	mediumaquamarine: [
		102,
		205,
		170
	],
	mediumblue: [
		0,
		0,
		205
	],
	mediumorchid: [
		186,
		85,
		211
	],
	mediumpurple: [
		147,
		112,
		219
	],
	mediumseagreen: [
		60,
		179,
		113
	],
	mediumslateblue: [
		123,
		104,
		238
	],
	mediumspringgreen: [
		0,
		250,
		154
	],
	mediumturquoise: [
		72,
		209,
		204
	],
	mediumvioletred: [
		199,
		21,
		133
	],
	midnightblue: [
		25,
		25,
		112
	],
	mintcream: [
		245,
		255,
		250
	],
	mistyrose: [
		255,
		228,
		225
	],
	moccasin: [
		255,
		228,
		181
	],
	navajowhite: [
		255,
		222,
		173
	],
	navy: [
		0,
		0,
		128
	],
	oldlace: [
		253,
		245,
		230
	],
	olive: [
		128,
		128,
		0
	],
	olivedrab: [
		107,
		142,
		35
	],
	orange: [
		255,
		165,
		0
	],
	orangered: [
		255,
		69,
		0
	],
	orchid: [
		218,
		112,
		214
	],
	palegoldenrod: [
		238,
		232,
		170
	],
	palegreen: [
		152,
		251,
		152
	],
	paleturquoise: [
		175,
		238,
		238
	],
	palevioletred: [
		219,
		112,
		147
	],
	papayawhip: [
		255,
		239,
		213
	],
	peachpuff: [
		255,
		218,
		185
	],
	peru: [
		205,
		133,
		63
	],
	pink: [
		255,
		192,
		203
	],
	plum: [
		221,
		160,
		221
	],
	powderblue: [
		176,
		224,
		230
	],
	purple: [
		128,
		0,
		128
	],
	red: [
		255,
		0,
		0
	],
	rosybrown: [
		188,
		143,
		143
	],
	royalblue: [
		65,
		105,
		225
	],
	saddlebrown: [
		139,
		69,
		19
	],
	salmon: [
		250,
		128,
		114
	],
	sandybrown: [
		244,
		164,
		96
	],
	seagreen: [
		46,
		139,
		87
	],
	seashell: [
		255,
		245,
		238
	],
	sienna: [
		160,
		82,
		45
	],
	silver: [
		192,
		192,
		192
	],
	skyblue: [
		135,
		206,
		235
	],
	slateblue: [
		106,
		90,
		205
	],
	slategray: [
		112,
		128,
		144
	],
	slategrey: [
		112,
		128,
		144
	],
	snow: [
		255,
		250,
		250
	],
	springgreen: [
		0,
		255,
		127
	],
	steelblue: [
		70,
		130,
		180
	],
	tan: [
		210,
		180,
		140
	],
	teal: [
		0,
		128,
		128
	],
	thistle: [
		216,
		191,
		216
	],
	tomato: [
		255,
		99,
		71
	],
	turquoise: [
		64,
		224,
		208
	],
	violet: [
		238,
		130,
		238
	],
	wheat: [
		245,
		222,
		179
	],
	white: [
		255,
		255,
		255
	],
	whitesmoke: [
		245,
		245,
		245
	],
	yellow: [
		255,
		255,
		0
	],
	yellowgreen: [
		154,
		205,
		50
	]
};
let cx;
let cy;
let px;
let py;
let sx;
let sy;
cx = cy = px = py = sx = sy = 0;
const parameters = {
	A: 7,
	a: 7,
	C: 6,
	c: 6,
	H: 1,
	h: 1,
	L: 2,
	l: 2,
	M: 2,
	m: 2,
	Q: 4,
	q: 4,
	S: 4,
	s: 4,
	T: 2,
	t: 2,
	V: 1,
	v: 1,
	Z: 0,
	z: 0
};
const isCommand = function(c) {
	return c in parameters;
};
const isWsp = function(c) {
	const codePoint = c.codePointAt(0);
	return codePoint === 32 || codePoint === 9 || codePoint === 13 || codePoint === 10;
};
const isDigit = function(c) {
	const codePoint = c.codePointAt(0);
	if (codePoint == null) return false;
	return 48 <= codePoint && codePoint <= 57;
};
const readNumber = function(string, cursor) {
	let i = cursor;
	let value = "";
	let state = "none";
	for (; i < string.length; i += 1) {
		const c = string[i];
		if (c === "+" || c === "-") {
			if (state === "none") {
				state = "sign";
				value += c;
				continue;
			}
			if (state === "e") {
				state = "exponent_sign";
				value += c;
				continue;
			}
		}
		if (isDigit(c)) {
			if (state === "none" || state === "sign" || state === "whole") {
				state = "whole";
				value += c;
				continue;
			}
			if (state === "decimal_point" || state === "decimal") {
				state = "decimal";
				value += c;
				continue;
			}
			if (state === "e" || state === "exponent_sign" || state === "exponent") {
				state = "exponent";
				value += c;
				continue;
			}
		}
		if (c === ".") {
			if (state === "none" || state === "sign" || state === "whole") {
				state = "decimal_point";
				value += c;
				continue;
			}
		}
		if (c === "E" || c === "e") {
			if (state === "whole" || state === "decimal_point" || state === "decimal") {
				state = "e";
				value += c;
				continue;
			}
		}
		break;
	}
	const number = Number.parseFloat(value);
	if (Number.isNaN(number)) return [cursor, null];
	return [i - 1, number];
};
const parse = function(path) {
	const pathData = [];
	let command = null;
	let args = [];
	let argsCount = 0;
	let canHaveComma = false;
	let hadComma = false;
	for (let i = 0; i < path.length; i += 1) {
		const c = path.charAt(i);
		if (isWsp(c)) continue;
		if (canHaveComma && c === ",") {
			if (hadComma) break;
			hadComma = true;
			continue;
		}
		if (isCommand(c)) {
			if (hadComma) return pathData;
			if (command == null) {
				if (c !== "M" && c !== "m") return pathData;
			} else if (args.length !== 0) return pathData;
			command = c;
			args = [];
			argsCount = parameters[command];
			canHaveComma = false;
			if (argsCount === 0) pathData.push({
				command,
				args
			});
			continue;
		}
		if (command == null) return pathData;
		let newCursor = i;
		let number = null;
		if (command === "A" || command === "a") {
			const position = args.length;
			if (position === 0 || position === 1) {
				if (c !== "+" && c !== "-") [newCursor, number] = readNumber(path, i);
			}
			if (position === 2 || position === 5 || position === 6) [newCursor, number] = readNumber(path, i);
			if (position === 3 || position === 4) {
				if (c === "0") number = 0;
				if (c === "1") number = 1;
			}
		} else [newCursor, number] = readNumber(path, i);
		if (number == null) return pathData;
		args.push(number);
		canHaveComma = true;
		hadComma = false;
		i = newCursor;
		if (args.length === argsCount) {
			pathData.push({
				command,
				args
			});
			if (command === "M") command = "L";
			if (command === "m") command = "l";
			args = [];
		}
	}
	return pathData;
};
const apply = function(commands, doc) {
	cx = cy = px = py = sx = sy = 0;
	for (let i = 0; i < commands.length; i++) {
		const c = commands[i];
		if (typeof runners[c.command] === "function") runners[c.command](doc, c.args);
	}
};
const runners = {
	M(doc, a) {
		cx = a[0];
		cy = a[1];
		px = py = null;
		sx = cx;
		sy = cy;
		return doc.moveTo(cx, cy);
	},
	m(doc, a) {
		cx += a[0];
		cy += a[1];
		px = py = null;
		sx = cx;
		sy = cy;
		return doc.moveTo(cx, cy);
	},
	C(doc, a) {
		cx = a[4];
		cy = a[5];
		px = a[2];
		py = a[3];
		return doc.bezierCurveTo(...a);
	},
	c(doc, a) {
		doc.bezierCurveTo(a[0] + cx, a[1] + cy, a[2] + cx, a[3] + cy, a[4] + cx, a[5] + cy);
		px = cx + a[2];
		py = cy + a[3];
		cx += a[4];
		return cy += a[5];
	},
	S(doc, a) {
		if (px === null) {
			px = cx;
			py = cy;
		}
		doc.bezierCurveTo(cx - (px - cx), cy - (py - cy), a[0], a[1], a[2], a[3]);
		px = a[0];
		py = a[1];
		cx = a[2];
		return cy = a[3];
	},
	s(doc, a) {
		if (px === null) {
			px = cx;
			py = cy;
		}
		doc.bezierCurveTo(cx - (px - cx), cy - (py - cy), cx + a[0], cy + a[1], cx + a[2], cy + a[3]);
		px = cx + a[0];
		py = cy + a[1];
		cx += a[2];
		return cy += a[3];
	},
	Q(doc, a) {
		px = a[0];
		py = a[1];
		cx = a[2];
		cy = a[3];
		return doc.quadraticCurveTo(a[0], a[1], cx, cy);
	},
	q(doc, a) {
		doc.quadraticCurveTo(a[0] + cx, a[1] + cy, a[2] + cx, a[3] + cy);
		px = cx + a[0];
		py = cy + a[1];
		cx += a[2];
		return cy += a[3];
	},
	T(doc, a) {
		if (px === null) {
			px = cx;
			py = cy;
		} else {
			px = cx - (px - cx);
			py = cy - (py - cy);
		}
		doc.quadraticCurveTo(px, py, a[0], a[1]);
		px = cx - (px - cx);
		py = cy - (py - cy);
		cx = a[0];
		return cy = a[1];
	},
	t(doc, a) {
		if (px === null) {
			px = cx;
			py = cy;
		} else {
			px = cx - (px - cx);
			py = cy - (py - cy);
		}
		doc.quadraticCurveTo(px, py, cx + a[0], cy + a[1]);
		cx += a[0];
		return cy += a[1];
	},
	A(doc, a) {
		solveArc(doc, cx, cy, a);
		cx = a[5];
		return cy = a[6];
	},
	a(doc, a) {
		a[5] += cx;
		a[6] += cy;
		solveArc(doc, cx, cy, a);
		cx = a[5];
		return cy = a[6];
	},
	L(doc, a) {
		cx = a[0];
		cy = a[1];
		px = py = null;
		return doc.lineTo(cx, cy);
	},
	l(doc, a) {
		cx += a[0];
		cy += a[1];
		px = py = null;
		return doc.lineTo(cx, cy);
	},
	H(doc, a) {
		cx = a[0];
		px = py = null;
		return doc.lineTo(cx, cy);
	},
	h(doc, a) {
		cx += a[0];
		px = py = null;
		return doc.lineTo(cx, cy);
	},
	V(doc, a) {
		cy = a[0];
		px = py = null;
		return doc.lineTo(cx, cy);
	},
	v(doc, a) {
		cy += a[0];
		px = py = null;
		return doc.lineTo(cx, cy);
	},
	Z(doc) {
		doc.closePath();
		cx = sx;
		return cy = sy;
	},
	z(doc) {
		doc.closePath();
		cx = sx;
		return cy = sy;
	}
};
const solveArc = function(doc, x, y, coords) {
	const [rx, ry, rot, large, sweep, ex, ey] = coords;
	const segs = arcToSegments(ex, ey, rx, ry, large, sweep, rot, x, y);
	for (let seg of segs) {
		const bez = segmentToBezier(...seg);
		doc.bezierCurveTo(...bez);
	}
};
const arcToSegments = function(x, y, rx, ry, large, sweep, rotateX, ox, oy) {
	const th = rotateX * (Math.PI / 180);
	const sin_th = Math.sin(th);
	const cos_th = Math.cos(th);
	rx = Math.abs(rx);
	ry = Math.abs(ry);
	px = cos_th * (ox - x) * .5 + sin_th * (oy - y) * .5;
	py = cos_th * (oy - y) * .5 - sin_th * (ox - x) * .5;
	let pl = px * px / (rx * rx) + py * py / (ry * ry);
	if (pl > 1) {
		pl = Math.sqrt(pl);
		rx *= pl;
		ry *= pl;
	}
	const a00 = cos_th / rx;
	const a01 = sin_th / rx;
	const a10 = -sin_th / ry;
	const a11 = cos_th / ry;
	const x0 = a00 * ox + a01 * oy;
	const y0 = a10 * ox + a11 * oy;
	const x1 = a00 * x + a01 * y;
	const y1 = a10 * x + a11 * y;
	let sfactor_sq = 1 / ((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0)) - .25;
	if (sfactor_sq < 0) sfactor_sq = 0;
	let sfactor = Math.sqrt(sfactor_sq);
	if (sweep === large) sfactor = -sfactor;
	const xc = .5 * (x0 + x1) - sfactor * (y1 - y0);
	const yc = .5 * (y0 + y1) + sfactor * (x1 - x0);
	const th0 = Math.atan2(y0 - yc, x0 - xc);
	let th_arc = Math.atan2(y1 - yc, x1 - xc) - th0;
	if (th_arc < 0 && sweep === 1) th_arc += 2 * Math.PI;
	else if (th_arc > 0 && sweep === 0) th_arc -= 2 * Math.PI;
	const segments = Math.ceil(Math.abs(th_arc / (Math.PI * .5 + .001)));
	const result = [];
	for (let i = 0; i < segments; i++) {
		const th2 = th0 + i * th_arc / segments;
		const th3 = th0 + (i + 1) * th_arc / segments;
		result[i] = [
			xc,
			yc,
			th2,
			th3,
			rx,
			ry,
			sin_th,
			cos_th
		];
	}
	return result;
};
const segmentToBezier = function(cx, cy, th0, th1, rx, ry, sin_th, cos_th) {
	const a00 = cos_th * rx;
	const a01 = -sin_th * ry;
	const a10 = sin_th * rx;
	const a11 = cos_th * ry;
	const th_half = .5 * (th1 - th0);
	const t = 8 / 3 * Math.sin(th_half * .5) * Math.sin(th_half * .5) / Math.sin(th_half);
	const x1 = cx + Math.cos(th0) - t * Math.sin(th0);
	const y1 = cy + Math.sin(th0) + t * Math.cos(th0);
	const x3 = cx + Math.cos(th1);
	const y3 = cy + Math.sin(th1);
	const x2 = x3 + t * Math.sin(th1);
	const y2 = y3 - t * Math.cos(th1);
	return [
		a00 * x1 + a01 * y1,
		a10 * x1 + a11 * y1,
		a00 * x2 + a01 * y2,
		a10 * x2 + a11 * y2,
		a00 * x3 + a01 * y3,
		a10 * x3 + a11 * y3
	];
};
var SVGPath = class {
	static apply(doc, path) {
		const commands = parse(path);
		apply(commands, doc);
	}
};
const { number: number$1 } = PDFObject;
const KAPPA = 4 * ((Math.sqrt(2) - 1) / 3);
var VectorMixin = {
	initVector() {
		this._ctm = [
			1,
			0,
			0,
			1,
			0,
			0
		];
		this._ctmStack = [];
	},
	save() {
		this._ctmStack.push(this._ctm.slice());
		return this.addContent("q");
	},
	restore() {
		this._ctm = this._ctmStack.pop() || [
			1,
			0,
			0,
			1,
			0,
			0
		];
		return this.addContent("Q");
	},
	closePath() {
		return this.addContent("h");
	},
	lineWidth(w) {
		return this.addContent(`${number$1(w)} w`);
	},
	_CAP_STYLES: {
		BUTT: 0,
		ROUND: 1,
		SQUARE: 2
	},
	lineCap(c) {
		if (typeof c === "string") c = this._CAP_STYLES[c.toUpperCase()];
		return this.addContent(`${c} J`);
	},
	_JOIN_STYLES: {
		MITER: 0,
		ROUND: 1,
		BEVEL: 2
	},
	lineJoin(j) {
		if (typeof j === "string") j = this._JOIN_STYLES[j.toUpperCase()];
		return this.addContent(`${j} j`);
	},
	miterLimit(m) {
		return this.addContent(`${number$1(m)} M`);
	},
	dash(length, options = {}) {
		const originalLength = length;
		if (!Array.isArray(length)) length = [length, options.space || length];
		if (!length.every((x) => Number.isFinite(x) && x > 0)) throw new Error(`dash(${JSON.stringify(originalLength)}, ${JSON.stringify(options)}) invalid, lengths must be numeric and greater than zero`);
		length = length.map(number$1).join(" ");
		return this.addContent(`[${length}] ${number$1(options.phase || 0)} d`);
	},
	undash() {
		return this.addContent("[] 0 d");
	},
	moveTo(x, y) {
		return this.addContent(`${number$1(x)} ${number$1(y)} m`);
	},
	lineTo(x, y) {
		return this.addContent(`${number$1(x)} ${number$1(y)} l`);
	},
	bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y) {
		return this.addContent(`${number$1(cp1x)} ${number$1(cp1y)} ${number$1(cp2x)} ${number$1(cp2y)} ${number$1(x)} ${number$1(y)} c`);
	},
	quadraticCurveTo(cpx, cpy, x, y) {
		return this.addContent(`${number$1(cpx)} ${number$1(cpy)} ${number$1(x)} ${number$1(y)} v`);
	},
	rect(x, y, w, h) {
		return this.addContent(`${number$1(x)} ${number$1(y)} ${number$1(w)} ${number$1(h)} re`);
	},
	roundedRect(x, y, w, h, borderRadius) {
		if (borderRadius == null) borderRadius = 0;
		let radii;
		if (Array.isArray(borderRadius)) radii = borderRadius.slice(0, 4);
		else radii = [
			borderRadius,
			borderRadius,
			borderRadius,
			borderRadius
		];
		const limit = Math.min(.5 * w, .5 * h);
		const rTL = Math.max(0, Math.min(radii[0] || 0, limit));
		const rTR = Math.max(0, Math.min(radii[1] || 0, limit));
		const rBR = Math.max(0, Math.min(radii[2] || 0, limit));
		const rBL = Math.max(0, Math.min(radii[3] || 0, limit));
		const cpTR = rTR * (1 - KAPPA);
		const cpBR = rBR * (1 - KAPPA);
		const cpBL = rBL * (1 - KAPPA);
		const cpTL = rTL * (1 - KAPPA);
		this.moveTo(x + rTL, y);
		this.lineTo(x + w - rTR, y);
		if (rTR > 0) this.bezierCurveTo(x + w - cpTR, y, x + w, y + cpTR, x + w, y + rTR);
		this.lineTo(x + w, y + h - rBR);
		if (rBR > 0) this.bezierCurveTo(x + w, y + h - cpBR, x + w - cpBR, y + h, x + w - rBR, y + h);
		this.lineTo(x + rBL, y + h);
		if (rBL > 0) this.bezierCurveTo(x + cpBL, y + h, x, y + h - cpBL, x, y + h - rBL);
		this.lineTo(x, y + rTL);
		if (rTL > 0) this.bezierCurveTo(x, y + cpTL, x + cpTL, y, x + rTL, y);
		return this.closePath();
	},
	ellipse(x, y, r1, r2) {
		if (r2 == null) r2 = r1;
		x -= r1;
		y -= r2;
		const ox = r1 * KAPPA;
		const oy = r2 * KAPPA;
		const xe = x + r1 * 2;
		const ye = y + r2 * 2;
		const xm = x + r1;
		const ym = y + r2;
		this.moveTo(x, ym);
		this.bezierCurveTo(x, ym - oy, xm - ox, y, xm, y);
		this.bezierCurveTo(xm + ox, y, xe, ym - oy, xe, ym);
		this.bezierCurveTo(xe, ym + oy, xm + ox, ye, xm, ye);
		this.bezierCurveTo(xm - ox, ye, x, ym + oy, x, ym);
		return this.closePath();
	},
	circle(x, y, radius) {
		return this.ellipse(x, y, radius);
	},
	arc(x, y, radius, startAngle, endAngle, anticlockwise) {
		if (anticlockwise == null) anticlockwise = false;
		const TWO_PI = 2 * Math.PI;
		const HALF_PI = .5 * Math.PI;
		let deltaAng = endAngle - startAngle;
		if (Math.abs(deltaAng) > TWO_PI) deltaAng = TWO_PI;
		else if (deltaAng !== 0 && anticlockwise !== deltaAng < 0) deltaAng = (anticlockwise ? -1 : 1) * TWO_PI + deltaAng;
		const numSegs = Math.ceil(Math.abs(deltaAng) / HALF_PI);
		const segAng = deltaAng / numSegs;
		const handleLen = segAng / HALF_PI * KAPPA * radius;
		let curAng = startAngle;
		let deltaCx = -Math.sin(curAng) * handleLen;
		let deltaCy = Math.cos(curAng) * handleLen;
		let ax = x + Math.cos(curAng) * radius;
		let ay = y + Math.sin(curAng) * radius;
		this.moveTo(ax, ay);
		for (let segIdx = 0; segIdx < numSegs; segIdx++) {
			const cp1x = ax + deltaCx;
			const cp1y = ay + deltaCy;
			curAng += segAng;
			ax = x + Math.cos(curAng) * radius;
			ay = y + Math.sin(curAng) * radius;
			deltaCx = -Math.sin(curAng) * handleLen;
			deltaCy = Math.cos(curAng) * handleLen;
			const cp2x = ax - deltaCx;
			const cp2y = ay - deltaCy;
			this.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, ax, ay);
		}
		return this;
	},
	polygon(...points) {
		this.moveTo(...points.shift() || []);
		for (let point of points) this.lineTo(...point || []);
		return this.closePath();
	},
	path(path) {
		SVGPath.apply(this, path);
		return this;
	},
	_windingRule(rule) {
		if (/even-?odd/.test(rule)) return "*";
		return "";
	},
	fill(color, rule) {
		if (/(even-?odd)|(non-?zero)/.test(color)) {
			rule = color;
			color = null;
		}
		if (color) this.fillColor(color);
		return this.addContent(`f${this._windingRule(rule)}`);
	},
	stroke(color) {
		if (color) this.strokeColor(color);
		return this.addContent("S");
	},
	fillAndStroke(fillColor, strokeColor, rule) {
		if (strokeColor == null) strokeColor = fillColor;
		const isFillRule = /(even-?odd)|(non-?zero)/;
		if (isFillRule.test(fillColor)) {
			rule = fillColor;
			fillColor = null;
		}
		if (isFillRule.test(strokeColor)) {
			rule = strokeColor;
			strokeColor = fillColor;
		}
		if (fillColor) {
			this.fillColor(fillColor);
			this.strokeColor(strokeColor);
		}
		return this.addContent(`B${this._windingRule(rule)}`);
	},
	clip(rule) {
		return this.addContent(`W${this._windingRule(rule)} n`);
	},
	transform(m11, m12, m21, m22, dx, dy) {
		if (m11 === 1 && m12 === 0 && m21 === 0 && m22 === 1 && dx === 0 && dy === 0) return this;
		const m = this._ctm;
		const [m0, m1, m2, m3, m4, m5] = m;
		m[0] = m0 * m11 + m2 * m12;
		m[1] = m1 * m11 + m3 * m12;
		m[2] = m0 * m21 + m2 * m22;
		m[3] = m1 * m21 + m3 * m22;
		m[4] = m0 * dx + m2 * dy + m4;
		m[5] = m1 * dx + m3 * dy + m5;
		const values = [
			m11,
			m12,
			m21,
			m22,
			dx,
			dy
		].map((v) => number$1(v)).join(" ");
		return this.addContent(`${values} cm`);
	},
	translate(x, y) {
		return this.transform(1, 0, 0, 1, x, y);
	},
	rotate(angle, options = {}) {
		let y;
		const rad = angle * Math.PI / 180;
		const cos = Math.cos(rad);
		const sin = Math.sin(rad);
		let x = y = 0;
		if (options.origin != null) {
			[x, y] = options.origin;
			const x1 = x * cos - y * sin;
			const y1 = x * sin + y * cos;
			x -= x1;
			y -= y1;
		}
		return this.transform(cos, sin, -sin, cos, x, y);
	},
	scale(xFactor, yFactor, options = {}) {
		let y;
		if (yFactor == null) yFactor = xFactor;
		if (typeof yFactor === "object") {
			options = yFactor;
			yFactor = xFactor;
		}
		let x = y = 0;
		if (options.origin != null) {
			[x, y] = options.origin;
			x -= xFactor * x;
			y -= yFactor * y;
		}
		return this.transform(xFactor, 0, 0, yFactor, x, y);
	}
};
const registeredFiles = /* @__PURE__ */ new Map();
const toNativePath = (path) => typeof path === "string" && path.startsWith("file:") ? new URL(path) : path;
var fs = {
	readFileSync(path) {
		if (registeredFiles.has(path)) return registeredFiles.get(path).data;
		return readFileSync(toNativePath(path));
	},
	statSync(path) {
		if (registeredFiles.has(path)) {
			const { birthtime, ctime } = registeredFiles.get(path);
			return {
				birthtime: new Date(birthtime),
				ctime: new Date(ctime)
			};
		}
		return statSync(toNativePath(path));
	}
};
const WIN_ANSI_MAP = {
	402: 131,
	8211: 150,
	8212: 151,
	8216: 145,
	8217: 146,
	8218: 130,
	8220: 147,
	8221: 148,
	8222: 132,
	8224: 134,
	8225: 135,
	8226: 149,
	8230: 133,
	8364: 128,
	8240: 137,
	8249: 139,
	8250: 155,
	710: 136,
	8482: 153,
	338: 140,
	339: 156,
	732: 152,
	352: 138,
	353: 154,
	376: 159,
	381: 142,
	382: 158
};
const characters = `\
.notdef       .notdef        .notdef        .notdef
.notdef       .notdef        .notdef        .notdef
.notdef       .notdef        .notdef        .notdef
.notdef       .notdef        .notdef        .notdef
.notdef       .notdef        .notdef        .notdef
.notdef       .notdef        .notdef        .notdef
.notdef       .notdef        .notdef        .notdef
.notdef       .notdef        .notdef        .notdef
  
space         exclam         quotedbl       numbersign
dollar        percent        ampersand      quotesingle
parenleft     parenright     asterisk       plus
comma         hyphen         period         slash
zero          one            two            three
four          five           six            seven
eight         nine           colon          semicolon
less          equal          greater        question
  
at            A              B              C
D             E              F              G
H             I              J              K
L             M              N              O
P             Q              R              S
T             U              V              W
X             Y              Z              bracketleft
backslash     bracketright   asciicircum    underscore
  
grave         a              b              c
d             e              f              g
h             i              j              k
l             m              n              o
p             q              r              s
t             u              v              w
x             y              z              braceleft
bar           braceright     asciitilde     .notdef
  
Euro          .notdef        quotesinglbase florin
quotedblbase  ellipsis       dagger         daggerdbl
circumflex    perthousand    Scaron         guilsinglleft
OE            .notdef        Zcaron         .notdef
.notdef       quoteleft      quoteright     quotedblleft
quotedblright bullet         endash         emdash
tilde         trademark      scaron         guilsinglright
oe            .notdef        zcaron         ydieresis
  
space         exclamdown     cent           sterling
currency      yen            brokenbar      section
dieresis      copyright      ordfeminine    guillemotleft
logicalnot    hyphen         registered     macron
degree        plusminus      twosuperior    threesuperior
acute         mu             paragraph      periodcentered
cedilla       onesuperior    ordmasculine   guillemotright
onequarter    onehalf        threequarters  questiondown
  
Agrave        Aacute         Acircumflex    Atilde
Adieresis     Aring          AE             Ccedilla
Egrave        Eacute         Ecircumflex    Edieresis
Igrave        Iacute         Icircumflex    Idieresis
Eth           Ntilde         Ograve         Oacute
Ocircumflex   Otilde         Odieresis      multiply
Oslash        Ugrave         Uacute         Ucircumflex
Udieresis     Yacute         Thorn          germandbls
  
agrave        aacute         acircumflex    atilde
adieresis     aring          ae             ccedilla
egrave        eacute         ecircumflex    edieresis
igrave        iacute         icircumflex    idieresis
eth           ntilde         ograve         oacute
ocircumflex   otilde         odieresis      divide
oslash        ugrave         uacute         ucircumflex
udieresis     yacute         thorn          ydieresis\
`.split(/\s+/);
var AFMFont = class {
	constructor(data) {
		this.name = data.name;
		this.bbox = data.bbox.slice();
		this.ascender = data.ascender;
		this.descender = data.descender;
		this.xHeight = data.xHeight;
		this.capHeight = data.capHeight;
		this.lineGap = this.bbox[3] - this.bbox[1] - (this.ascender - this.descender);
		const glyphNames = data.glyphNames.split(" ");
		this.glyphWidths = Object.fromEntries(glyphNames.map((name, index) => [name, data.glyphWidths[index]]));
		this.kernPairs = {};
		for (let index = 0; index < data.kernPairs.length; index += 2) {
			const amount = data.kernPairs[index];
			let pairId = 0;
			for (const delta of data.kernPairs[index + 1]) {
				pairId += delta;
				const left = Math.floor(pairId / glyphNames.length);
				const right = pairId % glyphNames.length;
				this.kernPairs[`${glyphNames[left]}\0${glyphNames[right]}`] = amount;
			}
		}
	}
	encodeText(text) {
		const res = [];
		for (let i = 0, len = text.length; i < len; i++) {
			let char = text.charCodeAt(i);
			char = WIN_ANSI_MAP[char] || char;
			res.push(char.toString(16));
		}
		return res;
	}
	glyphsForString(string) {
		const glyphs = [];
		for (let i = 0, len = string.length; i < len; i++) {
			const charCode = string.charCodeAt(i);
			glyphs.push(this.characterToGlyph(charCode));
		}
		return glyphs;
	}
	characterToGlyph(character) {
		return characters[WIN_ANSI_MAP[character] || character] || ".notdef";
	}
	widthOfGlyph(glyph) {
		return this.glyphWidths[glyph] || 0;
	}
	getKernPair(left, right) {
		return this.kernPairs[left + "\0" + right] || 0;
	}
	advancesForGlyphs(glyphs) {
		const advances = [];
		for (let index = 0; index < glyphs.length; index++) {
			const left = glyphs[index];
			const right = glyphs[index + 1];
			advances.push(this.widthOfGlyph(left) + this.getKernPair(left, right));
		}
		return advances;
	}
};
var PDFFont = class {
	constructor() {}
	encode() {
		throw new Error("Must be implemented by subclasses");
	}
	widthOfString() {
		throw new Error("Must be implemented by subclasses");
	}
	ref() {
		return this.dictionary != null ? this.dictionary : this.dictionary = this.document.ref();
	}
	finalize() {
		if (this.embedded || this.dictionary == null) return;
		this.embed();
		this.embedded = true;
	}
	embed() {
		throw new Error("Must be implemented by subclasses");
	}
	lineHeight(size, includeGap = false) {
		const gap = includeGap ? this.lineGap : 0;
		return (this.ascender + gap - this.descender) / 1e3 * size;
	}
};
var StandardFont = class extends PDFFont {
	constructor(document, fontData, id) {
		super();
		this.document = document;
		this.name = fontData.name;
		this.id = id;
		this.font = new AFMFont(fontData);
		({ascender: this.ascender, descender: this.descender, bbox: this.bbox, lineGap: this.lineGap, xHeight: this.xHeight, capHeight: this.capHeight} = this.font);
	}
	embed() {
		this.dictionary.data = {
			Type: "Font",
			BaseFont: this.name,
			Subtype: "Type1",
			Encoding: "WinAnsiEncoding"
		};
		return this.dictionary.end();
	}
	encode(text) {
		const encoded = this.font.encodeText(text);
		const glyphs = this.font.glyphsForString(`${text}`);
		const advances = this.font.advancesForGlyphs(glyphs);
		const positions = [];
		for (let i = 0; i < glyphs.length; i++) {
			const glyph = glyphs[i];
			positions.push({
				xAdvance: advances[i],
				yAdvance: 0,
				xOffset: 0,
				yOffset: 0,
				advanceWidth: this.font.widthOfGlyph(glyph)
			});
		}
		return [encoded, positions];
	}
	widthOfString(string, size) {
		const glyphs = this.font.glyphsForString(`${string}`);
		const advances = this.font.advancesForGlyphs(glyphs);
		let width = 0;
		for (let advance of advances) width += advance;
		const scale = size / 1e3;
		return width * scale;
	}
};
const toHex = function(num) {
	return `0000${num.toString(16)}`.slice(-4);
};
var EmbeddedFont = class extends PDFFont {
	constructor(document, font, id) {
		super();
		this.document = document;
		this.font = font;
		this.id = id;
		this.subset = this.font.createSubset();
		this.unicode = [[0]];
		this.widths = [this.font.getGlyph(0).advanceWidth];
		this.name = this.font.postscriptName;
		this.scale = 1e3 / this.font.unitsPerEm;
		this.ascender = this.font.ascent * this.scale;
		this.descender = this.font.descent * this.scale;
		this.xHeight = this.font.xHeight * this.scale;
		this.capHeight = this.font.capHeight * this.scale;
		this.lineGap = this.font.lineGap * this.scale;
		this.bbox = this.font.bbox;
		if (document.options.fontLayoutCache !== false) this.layoutCache = Object.create(null);
	}
	layoutRun(text, features) {
		const run = this.font.layout(text, features);
		for (let i = 0; i < run.positions.length; i++) {
			const position = run.positions[i];
			for (let key in position) position[key] *= this.scale;
			position.advanceWidth = run.glyphs[i].advanceWidth * this.scale;
		}
		return run;
	}
	layoutCached(text) {
		if (!this.layoutCache) return this.layoutRun(text);
		let cached;
		if (cached = this.layoutCache[text]) return cached;
		const run = this.layoutRun(text);
		this.layoutCache[text] = run;
		return run;
	}
	layout(text, features, onlyWidth) {
		if (features) return this.layoutRun(text, features);
		let glyphs = onlyWidth ? null : [];
		let positions = onlyWidth ? null : [];
		let advanceWidth = 0;
		let last = 0;
		let index = 0;
		while (index <= text.length) {
			var needle;
			if (index === text.length && last < index || (needle = text.charAt(index), [" ", "	"].includes(needle))) {
				const run = this.layoutCached(text.slice(last, ++index));
				if (!onlyWidth) {
					glyphs = glyphs.concat(run.glyphs);
					positions = positions.concat(run.positions);
				}
				advanceWidth += run.advanceWidth;
				last = index;
			} else index++;
		}
		return {
			glyphs,
			positions,
			advanceWidth
		};
	}
	encode(text, features) {
		const { glyphs, positions } = this.layout(text, features);
		const res = [];
		for (let i = 0; i < glyphs.length; i++) {
			const glyph = glyphs[i];
			const gid = this.subset.includeGlyph(glyph.id);
			res.push(`0000${gid.toString(16)}`.slice(-4));
			if (this.widths[gid] == null) this.widths[gid] = glyph.advanceWidth * this.scale;
			if (this.unicode[gid] == null) this.unicode[gid] = glyph.codePoints;
		}
		return [res, positions];
	}
	widthOfString(string, size, features) {
		return this.layout(string, features, true).advanceWidth * (size / 1e3);
	}
	embed() {
		const isCFF = this.subset.cff != null;
		const fontFile = this.document.ref();
		if (isCFF) fontFile.data.Subtype = "CIDFontType0C";
		fontFile.end(this.subset.encode());
		const familyClass = ((this.font["OS/2"] != null ? this.font["OS/2"].sFamilyClass : void 0) || 0) >> 8;
		let flags = 0;
		if (this.font.post.isFixedPitch) flags |= 1;
		if (1 <= familyClass && familyClass <= 7) flags |= 2;
		flags |= 4;
		if (familyClass === 10) flags |= 8;
		if (this.font.head.macStyle.italic) flags |= 64;
		const name = [
			1,
			2,
			3,
			4,
			5,
			6
		].map((i) => String.fromCharCode((this.id.charCodeAt(i) || 73) + 17)).join("") + "+" + this.font.postscriptName?.replaceAll(" ", "_");
		const { bbox } = this.font;
		const descriptor = this.document.ref({
			Type: "FontDescriptor",
			FontName: name,
			Flags: flags,
			FontBBox: [
				bbox.minX * this.scale,
				bbox.minY * this.scale,
				bbox.maxX * this.scale,
				bbox.maxY * this.scale
			],
			ItalicAngle: this.font.italicAngle,
			Ascent: this.ascender,
			Descent: this.descender,
			CapHeight: (this.font.capHeight || this.font.ascent) * this.scale,
			XHeight: (this.font.xHeight || 0) * this.scale,
			StemV: 0
		});
		if (isCFF) descriptor.data.FontFile3 = fontFile;
		else descriptor.data.FontFile2 = fontFile;
		if (this.document.subset && this.document.subset === 1) {
			const maxCID = this.widths.length - 1;
			const cidSetBuffer = new Uint8Array(Math.ceil((maxCID + 1) / 8));
			for (let cid = 0; cid <= maxCID; cid++) if (this.widths[cid] != null) cidSetBuffer[Math.floor(cid / 8)] |= 128 >> cid % 8;
			const CIDSetRef = this.document.ref();
			CIDSetRef.write(cidSetBuffer);
			CIDSetRef.end();
			descriptor.data.CIDSet = CIDSetRef;
		}
		descriptor.end();
		const descendantFontData = {
			Type: "Font",
			Subtype: "CIDFontType0",
			BaseFont: name,
			CIDSystemInfo: {
				Registry: /* @__PURE__ */ new String("Adobe"),
				Ordering: /* @__PURE__ */ new String("Identity"),
				Supplement: 0
			},
			FontDescriptor: descriptor,
			W: [0, this.widths]
		};
		if (!isCFF) {
			descendantFontData.Subtype = "CIDFontType2";
			descendantFontData.CIDToGIDMap = "Identity";
		}
		const descendantFont = this.document.ref(descendantFontData);
		descendantFont.end();
		this.dictionary.data = {
			Type: "Font",
			Subtype: "Type0",
			BaseFont: name,
			Encoding: "Identity-H",
			DescendantFonts: [descendantFont],
			ToUnicode: this.toUnicodeCmap()
		};
		return this.dictionary.end();
	}
	toUnicodeCmap() {
		const cmap = this.document.ref();
		const entries = [];
		for (let codePoints of this.unicode) {
			const encoded = [];
			for (let value of codePoints) {
				if (value > 65535) {
					value -= 65536;
					encoded.push(toHex(value >>> 10 & 1023 | 55296));
					value = 56320 | value & 1023;
				}
				encoded.push(toHex(value));
			}
			entries.push(`<${encoded.join(" ")}>`);
		}
		const chunkSize = 256;
		const chunks = Math.ceil(entries.length / chunkSize);
		const ranges = [];
		for (let i = 0; i < chunks; i++) {
			const start = i * chunkSize;
			const end = Math.min((i + 1) * chunkSize, entries.length);
			ranges.push(`<${toHex(start)}> <${toHex(end - 1)}> [${entries.slice(start, end).join(" ")}]`);
		}
		cmap.end(`\
/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo <<
  /Registry (Adobe)
  /Ordering (UCS)
  /Supplement 0
>> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000><ffff>
endcodespacerange
${ranges.length} beginbfrange
${ranges.join("\n")}
endbfrange
endcmap
CMapName currentdict /CMap defineresource pop
end
end\
`);
		return cmap;
	}
};
const STANDARD_FONT_NAME_SET = /* @__PURE__ */ new Set([
	"Courier",
	"Courier-Bold",
	"Courier-BoldOblique",
	"Courier-Oblique",
	"Helvetica",
	"Helvetica-Bold",
	"Helvetica-BoldOblique",
	"Helvetica-Oblique",
	"Symbol",
	"Times-Bold",
	"Times-BoldItalic",
	"Times-Italic",
	"Times-Roman",
	"ZapfDingbats"
]);
const validateFontData = (fontData, expectedName) => {
	if (fontData == null || typeof fontData !== "object" || !STANDARD_FONT_NAME_SET.has(fontData.name) || expectedName != null && fontData.name !== expectedName) throw new TypeError("Invalid standard font data.");
};
const standardFonts = /* @__PURE__ */ new Map();
const isStandardFont = (name) => STANDARD_FONT_NAME_SET.has(name);
const registerStdFontLoaders = (loaders) => {
	for (const [name, loader] of Object.entries(loaders)) {
		if (!STANDARD_FONT_NAME_SET.has(name) || typeof loader !== "function") throw new TypeError("Invalid standard font loader.");
		standardFonts.set(name, loader);
	}
};
const getStandardFont = (name) => {
	if (!STANDARD_FONT_NAME_SET.has(name)) return null;
	const font = standardFonts.get(name);
	if (font == null) throw new Error(`Standard font "${name}" is not registered. Call registerStdFonts() before using it.`);
	if (typeof font !== "function") return font;
	const data = font();
	validateFontData(data, name);
	standardFonts.set(name, data);
	return data;
};
var PDFFontFactory = class {
	static open(document, src, family, id) {
		let font;
		if (typeof src === "string") {
			if (isStandardFont(src)) return new StandardFont(document, getStandardFont(src), id);
			src = fs.readFileSync(src);
		}
		if (src instanceof Uint8Array) font = $d636bc798e7178db$export$185802fd694ee1f5(src, family);
		else if (src instanceof ArrayBuffer) font = $d636bc798e7178db$export$185802fd694ee1f5(new Uint8Array(src), family);
		else if (typeof src?.layout === "function") font = src;
		if (font == null) throw new Error("Not a supported font format or standard PDF font.");
		return new EmbeddedFont(document, font, id);
	}
};
const isEqualFont = (font1, font2) => {
	if (font1.font._tables?.head?.checkSumAdjustment !== font2.font._tables?.head?.checkSumAdjustment) return false;
	if (JSON.stringify(font1.font._tables?.name?.records) !== JSON.stringify(font2.font._tables?.name?.records)) return false;
	return true;
};
var FontsMixin = {
	initFonts(defaultFont = "Helvetica", defaultFontFamily = null, defaultFontSize = 12) {
		this._fontFamilies = {};
		this._fontCount = 0;
		this._fontSource = defaultFont;
		this._fontFamily = defaultFontFamily;
		this._fontSize = defaultFontSize;
		this._font = null;
		this._remSize = defaultFontSize;
		this._registeredFonts = {};
		if (defaultFont) this.font(defaultFont, defaultFontFamily);
	},
	font(src, family, size) {
		let cacheKey, font;
		if (typeof family === "number") {
			size = family;
			family = null;
		}
		if (typeof src === "string" && this._registeredFonts[src]) {
			cacheKey = src;
			({src, family} = this._registeredFonts[src]);
		} else {
			cacheKey = family || src;
			if (typeof cacheKey !== "string") cacheKey = null;
		}
		this._fontSource = src;
		this._fontFamily = family;
		if (size != null) this.fontSize(size);
		if (font = this._fontFamilies[cacheKey]) {
			this._font = font;
			return this;
		}
		const id = `F${++this._fontCount}`;
		this._font = PDFFontFactory.open(this, src, family, id);
		if ((font = this._fontFamilies[this._font.name]) && isEqualFont(this._font, font)) {
			this._font = font;
			return this;
		}
		if (cacheKey) this._fontFamilies[cacheKey] = this._font;
		if (this._font.name && !this._fontFamilies[this._font.name]) this._fontFamilies[this._font.name] = this._font;
		if (!cacheKey && (!this._font.name || this._fontFamilies[this._font.name] !== this._font)) this._fontFamilies[this._font.id] = this._font;
		return this;
	},
	fontSize(_fontSize) {
		this._fontSize = this.sizeToPoint(_fontSize);
		return this;
	},
	currentLineHeight(includeGap) {
		return this._font.lineHeight(this._fontSize, includeGap);
	},
	registerFont(name, src, family) {
		this._registeredFonts[name] = {
			src,
			family
		};
		return this;
	},
	sizeToPoint(size, defaultValue = 0, page = this.page, percentageWidth = void 0) {
		if (!percentageWidth) percentageWidth = this._fontSize;
		if (typeof defaultValue !== "number") defaultValue = this.sizeToPoint(defaultValue);
		if (size === void 0) return defaultValue;
		if (typeof size === "number") return size;
		if (typeof size === "boolean") return Number(size);
		const match = String(size).match(/((\d+)?(\.\d+)?)(em|in|px|cm|mm|pc|ex|ch|rem|vw|vh|vmin|vmax|%|pt)?/);
		if (!match) throw new Error(`Unsupported size '${size}'`);
		let multiplier;
		switch (match[4]) {
			case "em":
				multiplier = this._fontSize;
				break;
			case "in":
				multiplier = IN_TO_PT;
				break;
			case "px":
				multiplier = PX_TO_IN * IN_TO_PT;
				break;
			case "cm":
				multiplier = CM_TO_IN * IN_TO_PT;
				break;
			case "mm":
				multiplier = MM_TO_CM * CM_TO_IN * IN_TO_PT;
				break;
			case "pc":
				multiplier = PC_TO_PT;
				break;
			case "ex":
				multiplier = this.currentLineHeight();
				break;
			case "ch":
				multiplier = this.widthOfString("0");
				break;
			case "rem":
				multiplier = this._remSize;
				break;
			case "vw":
				multiplier = page.width / 100;
				break;
			case "vh":
				multiplier = page.height / 100;
				break;
			case "vmin":
				multiplier = Math.min(page.width, page.height) / 100;
				break;
			case "vmax":
				multiplier = Math.max(page.width, page.height) / 100;
				break;
			case "%":
				multiplier = percentageWidth / 100;
				break;
			default: multiplier = 1;
		}
		return multiplier * Number(match[1]);
	}
};
var EventEmitter = class {
	constructor() {
		this._listeners = Object.create(null);
	}
	on(event, listener) {
		(this._listeners[event] || (this._listeners[event] = [])).push(listener);
		return this;
	}
	once(event, listener) {
		const wrapper = (...args) => {
			this.off(event, wrapper);
			listener(...args);
		};
		return this.on(event, wrapper);
	}
	off(event, listener) {
		const listeners = this._listeners[event];
		if (listeners) {
			const index = listeners.indexOf(listener);
			if (index !== -1) listeners.splice(index, 1);
		}
		return this;
	}
	emit(event, ...args) {
		const listeners = this._listeners[event];
		if (!listeners) return false;
		for (const listener of listeners.slice()) listener(...args);
		return listeners.length > 0;
	}
};
const SOFT_HYPHEN = "­";
const HYPHEN = "-";
var LineWrapper = class extends EventEmitter {
	constructor(document, options) {
		super();
		this.document = document;
		this.horizontalScaling = options.horizontalScaling || 100;
		this.indent = (options.indent || 0) * this.horizontalScaling / 100;
		this.indentAllLines = options.indentAllLines || false;
		this.characterSpacing = (options.characterSpacing || 0) * this.horizontalScaling / 100;
		this.wordSpacing = (options.wordSpacing === 0) * this.horizontalScaling / 100;
		this.columns = options.columns || 1;
		this.columnGap = (options.columnGap != null ? options.columnGap : 18) * this.horizontalScaling / 100;
		this.lineWidth = (options.width * this.horizontalScaling / 100 - this.columnGap * (this.columns - 1)) / this.columns;
		this.spaceLeft = this.lineWidth;
		this.startX = this.document.x;
		this.startY = this.document.y;
		this.column = 1;
		this.ellipsis = options.ellipsis;
		this.continuedX = 0;
		this.indentApplied = false;
		this.features = options.features;
		if (options.height != null) {
			this.height = options.height;
			this.maxY = PDFNumber(this.startY + options.height);
		} else this.maxY = PDFNumber(this.document.page.maxY());
		this.on("firstLine", (options) => {
			const continuation = this.continuedX;
			const indent = continuation || this.indent;
			if (continuation || !this.indentApplied) {
				this.document.x += indent;
				this.lineWidth -= indent;
				this.indentApplied = true;
			}
			if (options.indentAllLines) {
				if (continuation) this.once("line", () => {
					this.document.x -= continuation;
					this.lineWidth += continuation;
				});
				return;
			}
			this.once("line", () => {
				this.document.x -= indent;
				this.lineWidth += indent;
				this.indentApplied = false;
				if (options.continued && !this.continuedX) this.continuedX = this.indent;
				if (!options.continued) this.continuedX = 0;
			});
		});
		this.on("lastLine", (options) => {
			const { align } = options;
			if (align === "justify") options.align = "left";
			this.lastLine = true;
			this.once("line", () => {
				this.document.y += options.paragraphGap || 0;
				options.align = align;
				return this.lastLine = false;
			});
		});
	}
	wordWidth(word) {
		return PDFNumber(this.document.widthOfString(word, this) + this.characterSpacing + this.wordSpacing);
	}
	canFit(word, w) {
		if (word[word.length - 1] != SOFT_HYPHEN) return w <= this.spaceLeft;
		return w + this.wordWidth(HYPHEN) <= this.spaceLeft;
	}
	eachWord(text, fn) {
		let bk;
		const breaker = new $557adaaeb0c7885f$exports(text);
		let last = null;
		const wordWidths = Object.create(null);
		while (bk = breaker.nextBreak()) {
			var shouldContinue;
			let word = text.slice((last != null ? last.position : void 0) || 0, bk.position);
			let w = wordWidths[word] != null ? wordWidths[word] : wordWidths[word] = this.wordWidth(word);
			if (w > this.lineWidth + this.continuedX) {
				let lbk = last;
				const fbk = {};
				while (word.length) {
					var l, mightGrow;
					if (w > this.spaceLeft) {
						l = Math.ceil(this.spaceLeft / (w / word.length));
						w = this.wordWidth(word.slice(0, l));
						mightGrow = w <= this.spaceLeft && l < word.length;
					} else l = word.length;
					let mustShrink = w > this.spaceLeft && l > 0;
					while (mustShrink || mightGrow) if (mustShrink) {
						w = this.wordWidth(word.slice(0, --l));
						mustShrink = w > this.spaceLeft && l > 0;
					} else {
						w = this.wordWidth(word.slice(0, ++l));
						mustShrink = w > this.spaceLeft && l > 0;
						mightGrow = w <= this.spaceLeft && l < word.length;
					}
					if (l === 0 && this.spaceLeft === this.lineWidth) l = 1;
					fbk.required = bk.required || l < word.length;
					shouldContinue = fn(word.slice(0, l), w, fbk, lbk);
					lbk = { required: false };
					word = word.slice(l);
					w = this.wordWidth(word);
					if (shouldContinue === false) break;
				}
			} else shouldContinue = fn(word, w, bk, last);
			if (shouldContinue === false) break;
			last = bk;
		}
	}
	wrap(text, options) {
		const { document } = this;
		this.horizontalScaling = options.horizontalScaling || 100;
		if (options.indent != null) this.indent = options.indent * this.horizontalScaling / 100;
		if (options.characterSpacing != null) this.characterSpacing = options.characterSpacing * this.horizontalScaling / 100;
		if (options.wordSpacing != null) this.wordSpacing = options.wordSpacing * this.horizontalScaling / 100;
		if (options.ellipsis != null) this.ellipsis = options.ellipsis;
		const nextY = document.y + document.currentLineHeight(true);
		if (document.y > this.maxY || nextY > this.maxY) this.nextSection();
		let buffer = "";
		let textWidth = 0;
		let wc = 0;
		let lc = 0;
		let continueY = document.y;
		const emitLine = () => {
			options.textWidth = textWidth + this.wordSpacing * (wc - 1);
			options.wordCount = wc;
			options.lineWidth = this.lineWidth;
			continueY = document.y;
			this.emit("line", buffer, options, this);
			return lc++;
		};
		this.emit("sectionStart", options, this);
		this.eachWord(text, (word, w, bk, last) => {
			if (last == null || last.required) {
				this.emit("firstLine", options, this);
				this.spaceLeft = this.lineWidth;
			}
			if (this.canFit(word, w)) {
				buffer += word;
				textWidth += w;
				wc++;
			}
			if (bk.required || !this.canFit(word, w)) {
				const lh = document.currentLineHeight(true);
				if (this.height != null && this.ellipsis && PDFNumber(document.y + lh * 2) > this.maxY && this.column >= this.columns) {
					if (this.ellipsis === true) this.ellipsis = "…";
					buffer = buffer.replace(/\s+$/, "");
					textWidth = this.wordWidth(buffer + this.ellipsis);
					while (buffer && textWidth > this.lineWidth) {
						buffer = buffer.slice(0, -1).replace(/\s+$/, "");
						textWidth = this.wordWidth(buffer + this.ellipsis);
					}
					if (textWidth <= this.lineWidth) buffer = buffer + this.ellipsis;
					textWidth = this.wordWidth(buffer);
				}
				if (bk.required) {
					if (w > this.spaceLeft) {
						emitLine();
						buffer = word;
						textWidth = w;
						wc = 1;
					}
					this.emit("lastLine", options, this);
				}
				if (buffer[buffer.length - 1] == SOFT_HYPHEN) {
					buffer = buffer.slice(0, -1) + HYPHEN;
					this.spaceLeft -= this.wordWidth(HYPHEN);
				}
				emitLine();
				if (PDFNumber(document.y + lh) > this.maxY) {
					this.emit("sectionEnd", options, this);
					if (!this.nextSection()) {
						wc = 0;
						buffer = "";
						return false;
					}
					this.emit("sectionStart", options, this);
				}
				if (bk.required) {
					this.spaceLeft = this.lineWidth;
					buffer = "";
					textWidth = 0;
					return wc = 0;
				} else {
					this.spaceLeft = this.lineWidth - w;
					buffer = word;
					textWidth = w;
					return wc = 1;
				}
			} else return this.spaceLeft -= w;
		});
		if (wc > 0) {
			this.emit("lastLine", options, this);
			emitLine();
		}
		this.emit("sectionEnd", options, this);
		if (options.continued === true) {
			if (lc > 1) this.continuedX = 0;
			this.continuedX += options.textWidth || 0;
			document.y = continueY;
		} else document.x = this.startX;
	}
	nextSection(options) {
		if (++this.column > this.columns) {
			if (this.height != null) return false;
			this.document.continueOnNewPage();
			this.column = 1;
			this.startY = this.document.page.margins.top;
			this.maxY = this.document.page.maxY();
			if (this.indentAllLines) {
				if (this.indentApplied) this.document.x += this.continuedX || this.indent;
			} else this.document.x = this.startX;
			if (this.document._fillColor) this.document.fillColor(...this.document._fillColor);
			this.emit("pageBreak", options, this);
		} else {
			this.document.x += this.lineWidth + this.columnGap;
			this.document.y = this.startY;
			this.emit("columnBreak", options, this);
		}
		return true;
	}
};
const { number } = PDFObject;
function formatListLabel(n, listType) {
	if (listType === "numbered") return `${n}.`;
	var letter = String.fromCharCode((n - 1) % 26 + 65);
	var times = Math.floor((n - 1) / 26 + 1);
	return `${Array(times + 1).join(letter)}.`;
}
var TextMixin = {
	initText() {
		this._line = this._line.bind(this);
		this.x = 0;
		this.y = 0;
		this._lineGap = 0;
	},
	lineGap(_lineGap) {
		this._lineGap = _lineGap;
		return this;
	},
	moveDown(lines) {
		if (lines == null) lines = 1;
		this.y += this.currentLineHeight(true) * lines + this._lineGap;
		return this;
	},
	moveUp(lines) {
		if (lines == null) lines = 1;
		this.y -= this.currentLineHeight(true) * lines + this._lineGap;
		return this;
	},
	_text(text, x, y, options, lineCallback) {
		options = this._initOptions(x, y, options);
		text = text == null ? "" : `${text}`;
		if (options.wordSpacing) text = text.replace(/\s{2,}/g, " ");
		const addStructure = () => {
			if (options.structParent) options.structParent.add(this.struct(options.structType || "P", [this.markStructureContent(options.structType || "P")]));
		};
		if (options.rotation !== 0) {
			this.save();
			this.rotate(-options.rotation, { origin: [this.x, this.y] });
		}
		if (options.width) {
			let wrapper = this._wrapper;
			if (!wrapper) {
				wrapper = new LineWrapper(this, options);
				wrapper.on("line", lineCallback);
				wrapper.on("firstLine", addStructure);
			}
			this._wrapper = options.continued ? wrapper : null;
			this._textOptions = options.continued ? options : null;
			wrapper.wrap(text, options);
		} else for (let line of text.split("\n")) {
			addStructure();
			lineCallback(line, options);
		}
		if (options.rotation !== 0) this.restore();
		return this;
	},
	text(text, x, y, options) {
		return this._text(text, x, y, options, this._line);
	},
	widthOfString(string, options = {}) {
		const horizontalScaling = options.horizontalScaling || 100;
		return (this._font.widthOfString(string, this._fontSize, options.features) + (options.characterSpacing || 0) * (string.length - 1)) * horizontalScaling / 100;
	},
	boundsOfString(string, x, y, options) {
		options = this._initOptions(x, y, options);
		({x, y} = this);
		const lineGap = options.lineGap ?? this._lineGap ?? 0;
		const lineHeight = this.currentLineHeight(true) + lineGap;
		let contentWidth = 0;
		string = String(string ?? "");
		if (options.wordSpacing) string = string.replace(/\s{2,}/g, " ");
		if (options.width) {
			let wrapper = new LineWrapper(this, options);
			wrapper.on("line", (text, options) => {
				this.y += lineHeight;
				text = text.replace(/\n/g, "");
				if (text.length) {
					let wordSpacing = options.wordSpacing ?? 0;
					const characterSpacing = options.characterSpacing ?? 0;
					if (options.width && options.align === "justify") {
						const words = text.trim().split(/\s+/);
						const textWidth = this.widthOfString(text.replace(/\s+/g, ""), options);
						const spaceWidth = this.widthOfString(" ") + characterSpacing;
						wordSpacing = Math.max(0, (options.lineWidth - textWidth) / Math.max(1, words.length - 1) - spaceWidth);
					}
					contentWidth = Math.max(contentWidth, options.textWidth + wordSpacing * (options.wordCount - 1) + characterSpacing * (text.length - 1));
				}
			});
			wrapper.wrap(string, options);
		} else for (let line of string.split("\n")) {
			const lineWidth = this.widthOfString(line, options);
			this.y += lineHeight;
			contentWidth = Math.max(contentWidth, lineWidth);
		}
		let contentHeight = this.y - y;
		if (options.height) contentHeight = Math.min(contentHeight, options.height);
		this.x = x;
		this.y = y;
		if (options.rotation === 0) return {
			x,
			y,
			width: contentWidth,
			height: contentHeight
		};
		else if (options.rotation === 90) return {
			x,
			y: y - contentWidth,
			width: contentHeight,
			height: contentWidth
		};
		else if (options.rotation === 180) return {
			x: x - contentWidth,
			y: y - contentHeight,
			width: contentWidth,
			height: contentHeight
		};
		else if (options.rotation === 270) return {
			x: x - contentHeight,
			y,
			width: contentHeight,
			height: contentWidth
		};
		const cos = cosine(options.rotation);
		const sin = sine(options.rotation);
		const x1 = x;
		const y1 = y;
		const x2 = x + contentWidth * cos;
		const y2 = y - contentWidth * sin;
		const x3 = x + contentWidth * cos + contentHeight * sin;
		const y3 = y - contentWidth * sin + contentHeight * cos;
		const x4 = x + contentHeight * sin;
		const y4 = y + contentHeight * cos;
		const xMin = Math.min(x1, x2, x3, x4);
		const xMax = Math.max(x1, x2, x3, x4);
		const yMin = Math.min(y1, y2, y3, y4);
		const yMax = Math.max(y1, y2, y3, y4);
		return {
			x: xMin,
			y: yMin,
			width: xMax - xMin,
			height: yMax - yMin
		};
	},
	heightOfString(text, options) {
		const { x, y } = this;
		options = this._initOptions(options);
		options.height = Infinity;
		const lineGap = options.lineGap || this._lineGap || 0;
		this._text(text, this.x, this.y, options, () => {
			this.y += this.currentLineHeight(true) + lineGap;
		});
		const height = this.y - y;
		this.x = x;
		this.y = y;
		return height;
	},
	list(list, x, y, options) {
		options = this._initOptions(x, y, options);
		const listType = options.listType || "bullet";
		const unit = Math.round(this._font.ascender / 1e3 * this._fontSize);
		const midLine = unit / 2;
		const r = options.bulletRadius || unit / 3;
		const indent = options.textIndent || (listType === "bullet" ? r * 5 : unit * 2);
		const itemIndent = options.bulletIndent || (listType === "bullet" ? r * 8 : unit * 2);
		let level = 1;
		const items = [];
		const levels = [];
		const numbers = [];
		var flatten = function(list) {
			let n = 1;
			for (let i = 0; i < list.length; i++) {
				const item = list[i];
				if (Array.isArray(item)) {
					level++;
					flatten(item);
					level--;
				} else {
					items.push(item);
					levels.push(level);
					if (listType !== "bullet") numbers.push(n++);
				}
			}
		};
		flatten(list);
		const drawListItem = function(listItem, i) {
			const wrapper = new LineWrapper(this, options);
			wrapper.on("line", this._line);
			level = 1;
			wrapper.once("firstLine", () => {
				let item, itemType, labelType, bodyType;
				if (options.structParent) {
					if (options.structTypes) [itemType, labelType, bodyType] = options.structTypes;
					else [itemType, labelType, bodyType] = [
						"LI",
						"Lbl",
						"LBody"
					];
				}
				if (itemType) {
					item = this.struct(itemType);
					options.structParent.add(item);
				} else if (options.structParent) item = options.structParent;
				let l;
				if ((l = levels[i++]) !== level) {
					const diff = itemIndent * (l - level);
					this.x += diff;
					wrapper.lineWidth -= diff;
					level = l;
				}
				if (item && (labelType || bodyType)) item.add(this.struct(labelType || bodyType, [this.markStructureContent(labelType || bodyType)]));
				switch (listType) {
					case "bullet":
						this.circle(this.x - indent + r, this.y + midLine, r);
						this.fill();
						break;
					case "numbered":
					case "lettered":
						var text = formatListLabel(numbers[i - 1], listType);
						this._fragment(text, this.x - indent, this.y, options);
				}
				if (item && labelType && bodyType) item.add(this.struct(bodyType, [this.markStructureContent(bodyType)]));
				if (item && item !== options.structParent) item.end();
			});
			wrapper.on("sectionStart", () => {
				const pos = indent + itemIndent * (level - 1);
				this.x += pos;
				wrapper.lineWidth -= pos;
			});
			wrapper.on("sectionEnd", () => {
				const pos = indent + itemIndent * (level - 1);
				this.x -= pos;
				wrapper.lineWidth += pos;
			});
			wrapper.wrap(listItem, options);
		};
		for (let i = 0; i < items.length; i++) drawListItem.call(this, items[i], i);
		return this;
	},
	_initOptions(x = {}, y, options = {}) {
		if (x && typeof x === "object") {
			options = x;
			x = null;
		}
		const result = Object.assign({}, options);
		if (this._textOptions) for (let key in this._textOptions) {
			const val = this._textOptions[key];
			if (key !== "continued") {
				if (result[key] === void 0) result[key] = val;
			}
		}
		if (x != null) this.x = x;
		if (y != null) this.y = y;
		if (result.lineBreak !== false) {
			if (result.width == null) result.width = this.page.width - this.x - this.page.margins.right;
			result.width = Math.max(result.width, 0);
		}
		if (!result.columns) result.columns = 0;
		if (result.columnGap == null) result.columnGap = 18;
		result.rotation = Number(result.rotation ?? 0) % 360;
		if (result.rotation < 0) result.rotation += 360;
		return result;
	},
	_line(text, options = {}, wrapper) {
		this._fragment(text, this.x, this.y, options);
		if (wrapper) {
			const lineGap = options.lineGap || this._lineGap || 0;
			this.y += this.currentLineHeight(true) + lineGap;
		} else this.x += this.widthOfString(text, options);
	},
	_fragment(text, x, y, options) {
		let dy, encoded, i, positions, textWidth, words;
		text = `${text}`.replace(/\n/g, "");
		if (text.length === 0) return;
		const align = options.align || "left";
		let wordSpacing = options.wordSpacing || 0;
		const characterSpacing = options.characterSpacing || 0;
		const horizontalScaling = options.horizontalScaling || 100;
		if (options.width) switch (align) {
			case "right":
				textWidth = this.widthOfString(text.replace(/\s+$/, ""), options);
				x += options.lineWidth - textWidth;
				break;
			case "center":
				x += options.lineWidth / 2 - options.textWidth / 2;
				break;
			case "justify":
				words = text.trim().split(/\s+/);
				textWidth = this.widthOfString(text.replace(/\s+/g, ""), options);
				var spaceWidth = this.widthOfString(" ") + characterSpacing;
				wordSpacing = Math.max(0, (options.lineWidth - textWidth) / Math.max(1, words.length - 1) - spaceWidth);
		}
		if (typeof options.baseline === "number") dy = -options.baseline;
		else {
			switch (options.baseline) {
				case "svg-middle":
					dy = .5 * this._font.xHeight;
					break;
				case "middle":
				case "svg-central":
					dy = .5 * (this._font.descender + this._font.ascender);
					break;
				case "bottom":
				case "ideographic":
					dy = this._font.descender;
					break;
				case "alphabetic":
					dy = 0;
					break;
				case "mathematical":
					dy = .5 * this._font.ascender;
					break;
				case "hanging":
					dy = .8 * this._font.ascender;
					break;
				case "top":
					dy = this._font.ascender;
					break;
				default: dy = this._font.ascender;
			}
			dy = dy / 1e3 * this._fontSize;
		}
		const measuredWidth = options.textWidth ?? this.widthOfString(text, options) - characterSpacing * (text.length - 1);
		const measuredWordCount = options.wordCount ?? (text.trim() ? text.trim().split(/\s+/).length : 0);
		const renderedWidth = measuredWidth + wordSpacing * (measuredWordCount - 1) + characterSpacing * (text.length - 1);
		if (options.link != null) {
			const linkOptions = {};
			if (this._currentStructureElement && this._currentStructureElement.dictionary.data.S === "Link") linkOptions.structParent = this._currentStructureElement;
			this.link(x, y, renderedWidth, this.currentLineHeight(), options.link, linkOptions);
		}
		if (options.goTo != null) this.goTo(x, y, renderedWidth, this.currentLineHeight(), options.goTo);
		if (options.destination != null) this.addNamedDestination(options.destination, "XYZ", x, y, null);
		if (options.underline) {
			this.save();
			if (!options.stroke) this.strokeColor(...this._fillColor || []);
			const lineWidth = this._fontSize < 10 ? .5 : Math.floor(this._fontSize / 10);
			this.lineWidth(lineWidth);
			let lineY = y + this.currentLineHeight() - lineWidth;
			this.moveTo(x, lineY);
			this.lineTo(x + renderedWidth, lineY);
			this.stroke();
			this.restore();
		}
		if (options.strike) {
			this.save();
			if (!options.stroke) this.strokeColor(...this._fillColor || []);
			const lineWidth = this._fontSize < 10 ? .5 : Math.floor(this._fontSize / 10);
			this.lineWidth(lineWidth);
			let lineY = y + this.currentLineHeight() / 2;
			this.moveTo(x, lineY);
			this.lineTo(x + renderedWidth, lineY);
			this.stroke();
			this.restore();
		}
		this.save();
		if (options.oblique) {
			let skew;
			if (typeof options.oblique === "number") skew = -Math.tan(options.oblique * Math.PI / 180);
			else skew = -.25;
			this.transform(1, 0, 0, 1, x, y);
			this.transform(1, 0, skew, 1, -skew * dy, 0);
			this.transform(1, 0, 0, 1, -x, -y);
		}
		this.transform(1, 0, 0, -1, 0, this.page.height);
		y = this.page.height - y - dy;
		if (this.page.fonts[this._font.id] == null) this.page.fonts[this._font.id] = this._font.ref();
		this.addContent("BT");
		this.addContent(`1 0 0 1 ${number(x)} ${number(y)} Tm`);
		this.addContent(`/${this._font.id} ${number(this._fontSize)} Tf`);
		const mode = options.fill && options.stroke ? 2 : options.stroke ? 1 : 0;
		if (mode) this.addContent(`${mode} Tr`);
		if (characterSpacing) this.addContent(`${number(characterSpacing)} Tc`);
		if (horizontalScaling !== 100) this.addContent(`${horizontalScaling} Tz`);
		if (wordSpacing) {
			words = text.trim().split(/\s+/);
			wordSpacing += this.widthOfString(" ") + characterSpacing;
			wordSpacing *= 1e3 / this._fontSize;
			encoded = [];
			positions = [];
			for (let word of words) {
				const [encodedWord, positionsWord] = this._font.encode(word, options.features);
				encoded = encoded.concat(encodedWord);
				positions = positions.concat(positionsWord);
				const space = {};
				const object = positions[positions.length - 1];
				for (let key in object) space[key] = object[key];
				space.xAdvance += wordSpacing;
				positions[positions.length - 1] = space;
			}
		} else [encoded, positions] = this._font.encode(text, options.features);
		const scale = this._fontSize / 1e3;
		const commands = [];
		let last = 0;
		let hadOffset = false;
		const addSegment = (cur) => {
			if (last < cur) {
				const hex = encoded.slice(last, cur).join("");
				const advance = positions[cur - 1].xAdvance - positions[cur - 1].advanceWidth;
				commands.push(`<${hex}> ${number(-advance)}`);
			}
			last = cur;
		};
		const flush = (i) => {
			addSegment(i);
			if (commands.length > 0) {
				this.addContent(`[${commands.join(" ")}] TJ`);
				commands.length = 0;
			}
		};
		for (i = 0; i < positions.length; i++) {
			const pos = positions[i];
			if (pos.xOffset || pos.yOffset) {
				flush(i);
				this.addContent(`1 0 0 1 ${number(x + pos.xOffset * scale)} ${number(y + pos.yOffset * scale)} Tm`);
				flush(i + 1);
				hadOffset = true;
			} else {
				if (hadOffset) {
					this.addContent(`1 0 0 1 ${number(x)} ${number(y)} Tm`);
					hadOffset = false;
				}
				if (pos.xAdvance - pos.advanceWidth !== 0) addSegment(i + 1);
			}
			x += pos.xAdvance * scale;
		}
		flush(i);
		this.addContent("ET");
		this.restore();
	}
};
const parseExifOrientation = (data) => {
	if (!data || data.length < 20) return null;
	let pos = 2;
	while (pos < data.length - 4) {
		while (pos < data.length && data[pos] !== 255) pos++;
		if (pos >= data.length - 4) return null;
		const marker = readUInt16BE(data, pos);
		pos += 2;
		if (marker === 65498) return null;
		if (marker >= 65488 && marker <= 65497 || marker === 65281) continue;
		if (pos + 2 > data.length) return null;
		const segmentLength = readUInt16BE(data, pos);
		if (marker === 65505 && pos + 8 <= data.length) {
			if (toBinaryString(data.subarray(pos + 2, pos + 8)) === "Exif\0\0") {
				const tiffStart = pos + 8;
				if (tiffStart + 8 > data.length) return null;
				const byteOrder = toBinaryString(data.subarray(tiffStart, tiffStart + 2));
				const isLittleEndian = byteOrder === "II";
				if (!isLittleEndian && byteOrder !== "MM") return null;
				const read16 = isLittleEndian ? (o) => readUInt16LE(data, o) : (o) => readUInt16BE(data, o);
				const read32 = isLittleEndian ? (o) => readUInt32LE(data, o) : (o) => readUInt32BE(data, o);
				if (read16(tiffStart + 2) !== 42) return null;
				const ifdPos = tiffStart + read32(tiffStart + 4);
				if (ifdPos + 2 > data.length) return null;
				const entryCount = read16(ifdPos);
				for (let i = 0; i < entryCount; i++) {
					const entryPos = ifdPos + 2 + i * 12;
					if (entryPos + 12 > data.length) return null;
					if (read16(entryPos) === 274) {
						const value = read16(entryPos + 8);
						return value >= 1 && value <= 8 ? value : null;
					}
				}
				return null;
			}
		}
		pos += segmentLength;
	}
	return null;
};
const MARKERS = [
	65472,
	65473,
	65474,
	65475,
	65477,
	65478,
	65479,
	65480,
	65481,
	65482,
	65483,
	65484,
	65485,
	65486,
	65487
];
const COLOR_SPACE_MAP = {
	1: "DeviceGray",
	3: "DeviceRGB",
	4: "DeviceCMYK"
};
var JPEG = class {
	constructor(data, label) {
		let marker;
		this.data = data;
		this.label = label;
		if (readUInt16BE(this.data, 0) !== 65496) throw "SOI not found in JPEG";
		this.orientation = parseExifOrientation(this.data) || 1;
		let pos = 2;
		while (pos < this.data.length) {
			while (pos < this.data.length && this.data[pos] !== 255) pos++;
			if (pos >= this.data.length) break;
			marker = readUInt16BE(this.data, pos);
			pos += 2;
			if (MARKERS.includes(marker)) break;
			pos += readUInt16BE(this.data, pos);
		}
		if (!MARKERS.includes(marker)) throw "Invalid JPEG.";
		pos += 2;
		this.bits = this.data[pos++];
		this.height = readUInt16BE(this.data, pos);
		pos += 2;
		this.width = readUInt16BE(this.data, pos);
		pos += 2;
		const channels = this.data[pos];
		this.colorSpace = COLOR_SPACE_MAP[channels];
		this.obj = null;
	}
	embed(document) {
		if (this.obj) return;
		this.obj = document.ref({
			Type: "XObject",
			Subtype: "Image",
			BitsPerComponent: this.bits,
			Width: this.width,
			Height: this.height,
			ColorSpace: this.colorSpace,
			Filter: "DCTDecode"
		});
		if (this.colorSpace === "DeviceCMYK") this.obj.data["Decode"] = [
			1,
			0,
			1,
			0,
			1,
			0,
			1,
			0
		];
		this.obj.end(this.data);
		return this.data = null;
	}
};
var PNGImage = class {
	constructor(data, label) {
		this.label = label;
		this.image = new PNG(data);
		this.width = this.image.width;
		this.height = this.image.height;
		this.imgData = this.image.imgData;
		this.obj = null;
	}
	embed(document) {
		this.document = document;
		if (this.obj) return;
		const { image, height, width } = this;
		const hasAlphaChannel = image.hasAlphaChannel;
		const isInterlaced = image.interlaceMethod === 1;
		const obj = this.obj = document.ref({
			Type: "XObject",
			Subtype: "Image",
			BitsPerComponent: hasAlphaChannel ? 8 : image.bits,
			Width: width,
			Height: height,
			Filter: "FlateDecode"
		});
		if (!hasAlphaChannel) {
			const params = document.ref({
				Predictor: isInterlaced ? 1 : 15,
				Colors: image.colors,
				BitsPerComponent: image.bits,
				Columns: width
			});
			obj.data["DecodeParms"] = params;
			params.end();
		}
		if (image.palette.length === 0) obj.data["ColorSpace"] = image.colorSpace;
		else {
			const palette = document.ref();
			palette.end(new Uint8Array(image.palette));
			obj.data["ColorSpace"] = [
				"Indexed",
				"DeviceRGB",
				image.palette.length / 3 - 1,
				palette
			];
		}
		if (image.transparency.grayscale != null) {
			const val = image.transparency.grayscale;
			obj.data["Mask"] = [val, val];
		} else if (image.transparency.rgb) {
			const { rgb } = image.transparency;
			const mask = [];
			for (let x of rgb) mask.push(x, x);
			obj.data["Mask"] = mask;
		} else if (image.transparency.indexed) return this.loadIndexedAlphaChannel();
		else if (hasAlphaChannel) return this.splitAlphaChannel();
		if (isInterlaced && true) return this.decodeData();
		this.finalize();
	}
	finalize() {
		if (this.alphaChannel) {
			const sMask = this.document.ref({
				Type: "XObject",
				Subtype: "Image",
				Height: this.height,
				Width: this.width,
				BitsPerComponent: 8,
				Filter: "FlateDecode",
				ColorSpace: "DeviceGray",
				Decode: [0, 1]
			});
			sMask.end(this.alphaChannel);
			this.obj.data["SMask"] = sMask;
		}
		this.obj.end(this.imgData);
		this.image = null;
		return this.imgData = null;
	}
	splitAlphaChannel() {
		return this.image.decodePixels((pixels) => {
			let a, p;
			const colorCount = this.image.colors;
			const pixelCount = this.width * this.height;
			const imgData = new Uint8Array(pixelCount * colorCount);
			const alphaChannel = new Uint8Array(pixelCount);
			let i = p = a = 0;
			const len = pixels.length;
			const skipByteCount = this.image.bits === 16 ? 1 : 0;
			while (i < len) {
				for (let colorIndex = 0; colorIndex < colorCount; colorIndex++) {
					imgData[p++] = pixels[i++];
					i += skipByteCount;
				}
				alphaChannel[a++] = pixels[i++];
				i += skipByteCount;
			}
			this.imgData = zlib.deflateSync(imgData);
			this.alphaChannel = zlib.deflateSync(alphaChannel);
			return this.finalize();
		});
	}
	loadIndexedAlphaChannel() {
		const transparency = this.image.transparency.indexed;
		const isInterlaced = this.image.interlaceMethod === 1;
		return this.image.decodePixels((pixels) => {
			const alphaChannel = new Uint8Array(this.width * this.height);
			let i = 0;
			for (let j = 0, end = pixels.length; j < end; j++) alphaChannel[i++] = transparency[pixels[j]];
			if (isInterlaced) this.imgData = zlib.deflateSync(pixels);
			this.alphaChannel = zlib.deflateSync(alphaChannel);
			return this.finalize();
		});
	}
	decodeData() {
		this.image.decodePixels((pixels) => {
			this.imgData = zlib.deflateSync(pixels);
			this.finalize();
		});
	}
};
var PDFImage = class {
	static open(src, label) {
		let data;
		if (src instanceof Uint8Array) data = src;
		else if (src instanceof ArrayBuffer) data = new Uint8Array(src);
		else {
			const match = /^data:.+?;base64,(.*)$/.exec(src);
			if (match) data = fromBase64(match[1]);
			else {
				data = fs.readFileSync(src);
				if (!data) return;
			}
		}
		if (data[0] === 255 && data[1] === 216) return new JPEG(data, label);
		else if (data[0] === 137 && data[1] === 80 && data[2] === 78 && data[3] === 71) return new PNGImage(data, label);
		else throw new Error("Unknown image format.");
	}
};
var ImagesMixin = {
	initImages() {
		this._imageRegistry = {};
		this._imageCount = 0;
	},
	image(src, x, y, options = {}) {
		let bh, bp, bw, image, ip, left, left1, originX, originY;
		if (typeof x === "object") {
			options = x;
			x = null;
		}
		const ignoreOrientation = options.ignoreOrientation || options.ignoreOrientation !== false && this.options.ignoreOrientation;
		const inDocumentFlow = typeof y !== "number";
		x = (left = x != null ? x : options.x) != null ? left : this.x;
		y = (left1 = y != null ? y : options.y) != null ? left1 : this.y;
		if (typeof src === "string") image = this._imageRegistry[src];
		if (!image) {
			if (src.width && src.height) image = src;
			else image = this.openImage(src);
		}
		if (!image.obj) image.embed(this);
		if (this.page.xobjects[image.label] == null) this.page.xobjects[image.label] = image.obj;
		let { width, height } = image;
		if (!ignoreOrientation && image.orientation > 4) [width, height] = [height, width];
		let w = options.width || width;
		let h = options.height || height;
		if (options.width && !options.height) {
			const wp = w / width;
			w = width * wp;
			h = height * wp;
		} else if (options.height && !options.width) {
			const hp = h / height;
			w = width * hp;
			h = height * hp;
		} else if (options.scale) {
			w = width * options.scale;
			h = height * options.scale;
		} else if (options.fit) {
			[bw, bh] = options.fit;
			bp = bw / bh;
			ip = width / height;
			if (ip > bp) {
				w = bw;
				h = bw / ip;
			} else {
				h = bh;
				w = bh * ip;
			}
		} else if (options.cover) {
			[bw, bh] = options.cover;
			bp = bw / bh;
			ip = width / height;
			if (ip > bp) {
				h = bh;
				w = bh * ip;
			} else {
				w = bw;
				h = bw / ip;
			}
		}
		if (options.fit || options.cover) {
			if (options.align === "center") x = x + bw / 2 - w / 2;
			else if (options.align === "right") x = x + bw - w;
			if (options.valign === "center") y = y + bh / 2 - h / 2;
			else if (options.valign === "bottom") y = y + bh - h;
		}
		let rotateAngle = 0;
		let xTransform = x;
		let yTransform = y;
		let hTransform = h;
		let wTransform = w;
		if (!ignoreOrientation) switch (image.orientation) {
			default:
			case 1:
				hTransform = -h;
				yTransform += h;
				break;
			case 2:
				wTransform = -w;
				hTransform = -h;
				xTransform += w;
				yTransform += h;
				break;
			case 3:
				originX = x;
				originY = y;
				hTransform = -h;
				xTransform -= w;
				rotateAngle = 180;
				break;
			case 4: break;
			case 5:
				originX = x;
				originY = y;
				wTransform = h;
				hTransform = w;
				yTransform -= hTransform;
				rotateAngle = 90;
				break;
			case 6:
				originX = x;
				originY = y;
				wTransform = h;
				hTransform = -w;
				rotateAngle = 90;
				break;
			case 7:
				originX = x;
				originY = y;
				hTransform = -w;
				wTransform = -h;
				xTransform += h;
				rotateAngle = 90;
				break;
			case 8:
				originX = x;
				originY = y;
				wTransform = h;
				hTransform = -w;
				xTransform -= h;
				yTransform += w;
				rotateAngle = -90;
		}
		else {
			hTransform = -h;
			yTransform += h;
		}
		if (options.link != null) this.link(x, y, w, h, options.link);
		if (options.goTo != null) this.goTo(x, y, w, h, options.goTo);
		if (options.destination != null) this.addNamedDestination(options.destination, "XYZ", x, y, null);
		if (inDocumentFlow) this.y += h;
		this.save();
		if (options.opacity != null) this._doOpacity(options.opacity, null);
		if (rotateAngle) this.rotate(rotateAngle, { origin: [originX, originY] });
		this.transform(wTransform, 0, 0, hTransform, xTransform, yTransform);
		this.addContent(`/${image.label} Do`);
		this.restore();
		return this;
	},
	openImage(src) {
		let image;
		if (typeof src === "string") image = this._imageRegistry[src];
		if (!image) {
			image = PDFImage.open(src, `I${++this._imageCount}`);
			if (typeof src === "string") this._imageRegistry[src] = image;
		}
		return image;
	}
};
var PDFAnnotationReference = class {
	constructor(annotationRef) {
		this.annotationRef = annotationRef;
	}
};
var AnnotationsMixin = {
	annotate(x, y, w, h, options) {
		const { structParent, color, ...annotations } = options;
		annotations.Type = "Annot";
		annotations.Rect = this._convertRect(x, y, w, h);
		annotations.Border = [
			0,
			0,
			0
		];
		if (annotations.Subtype === "Link" && typeof annotations.F === "undefined") annotations.F = 4;
		if (annotations.Subtype !== "Link") {
			if (annotations.C == null) annotations.C = this._normalizeColor(color || [
				0,
				0,
				0
			]);
		}
		if (typeof annotations.Dest === "string") annotations.Dest = new String(annotations.Dest);
		const ref = this.ref(annotations);
		this.page.annotations.push(ref);
		if (typeof structParent?.add === "function") {
			const annotRef = new PDFAnnotationReference(ref);
			structParent.add(annotRef);
		}
		ref.end();
		return this;
	},
	note(x, y, w, h, contents, options) {
		const annotationOptions = {
			...options,
			Subtype: "Text",
			Contents: new String(contents)
		};
		if (annotationOptions.Name == null) annotationOptions.Name = "Comment";
		if (annotationOptions.color == null) annotationOptions.color = [
			243,
			223,
			92
		];
		return this.annotate(x, y, w, h, annotationOptions);
	},
	goTo(x, y, w, h, name, options) {
		const annotateOptions = {
			...options,
			Subtype: "Link",
			A: this.ref({
				S: "GoTo",
				D: new String(name)
			})
		};
		annotateOptions.A.end();
		return this.annotate(x, y, w, h, annotateOptions);
	},
	link(x, y, w, h, url, options) {
		const annotateOptions = {
			...options,
			Subtype: "Link"
		};
		if (typeof url === "number") {
			const pages = this._root.data.Pages.data;
			if (url >= 0 && url < pages.Kids.length) {
				annotateOptions.A = this.ref({
					S: "GoTo",
					D: [
						pages.Kids[url],
						"XYZ",
						null,
						null,
						null
					]
				});
				annotateOptions.A.end();
			} else throw new Error(`The document has no page ${url}`);
		} else {
			annotateOptions.A = this.ref({
				S: "URI",
				URI: new String(url)
			});
			annotateOptions.A.end();
		}
		if (annotateOptions.structParent && !annotateOptions.Contents) annotateOptions.Contents = /* @__PURE__ */ new String("");
		return this.annotate(x, y, w, h, annotateOptions);
	},
	_markup(x, y, w, h, options) {
		const [x1, y1, x2, y2] = this._convertRect(x, y, w, h);
		return this.annotate(x, y, w, h, {
			...options,
			QuadPoints: [
				x1,
				y2,
				x2,
				y2,
				x1,
				y1,
				x2,
				y1
			],
			Contents: /* @__PURE__ */ new String()
		});
	},
	highlight(x, y, w, h, options) {
		const annotationOptions = {
			...options,
			Subtype: "Highlight"
		};
		if (annotationOptions.color == null) annotationOptions.color = [
			241,
			238,
			148
		];
		return this._markup(x, y, w, h, annotationOptions);
	},
	underline(x, y, w, h, options) {
		const annotationOptions = {
			...options,
			Subtype: "Underline"
		};
		return this._markup(x, y, w, h, annotationOptions);
	},
	strike(x, y, w, h, options) {
		const annotationOptions = {
			...options,
			Subtype: "StrikeOut"
		};
		return this._markup(x, y, w, h, annotationOptions);
	},
	lineAnnotation(x1, y1, x2, y2, options) {
		const annotationOptions = {
			...options,
			Subtype: "Line",
			Contents: /* @__PURE__ */ new String(),
			L: [
				x1,
				this.page.height - y1,
				x2,
				this.page.height - y2
			]
		};
		return this.annotate(x1, y1, x2, y2, annotationOptions);
	},
	rectAnnotation(x, y, w, h, options) {
		const annotationOptions = {
			...options,
			Subtype: "Square",
			Contents: /* @__PURE__ */ new String()
		};
		return this.annotate(x, y, w, h, annotationOptions);
	},
	ellipseAnnotation(x, y, w, h, options) {
		const annotationOptions = {
			...options,
			Subtype: "Circle",
			Contents: /* @__PURE__ */ new String()
		};
		return this.annotate(x, y, w, h, annotationOptions);
	},
	textAnnotation(x, y, w, h, text, options) {
		const annotationOptions = {
			...options,
			Subtype: "FreeText",
			Contents: new String(text),
			DA: /* @__PURE__ */ new String()
		};
		return this.annotate(x, y, w, h, annotationOptions);
	},
	fileAnnotation(x, y, w, h, file = {}, options) {
		const filespec = this.file(file.src, Object.assign({ hidden: true }, file));
		const annotationOptions = {
			...options,
			Subtype: "FileAttachment",
			FS: filespec
		};
		if (annotationOptions.Contents) annotationOptions.Contents = new String(annotationOptions.Contents);
		else if (filespec.data.Desc) annotationOptions.Contents = new String(filespec.data.Desc);
		return this.annotate(x, y, w, h, annotationOptions);
	},
	_convertRect(x1, y1, w, h) {
		let y2 = y1;
		y1 += h;
		let x2 = x1 + w;
		const [m0, m1, m2, m3, m4, m5] = this._ctm;
		x1 = m0 * x1 + m2 * y1 + m4;
		y1 = m1 * x1 + m3 * y1 + m5;
		x2 = m0 * x2 + m2 * y2 + m4;
		y2 = m1 * x2 + m3 * y2 + m5;
		return [
			x1,
			y1,
			x2,
			y2
		];
	}
};
const DEFAULT_OPTIONS = {
	top: 0,
	left: 0,
	zoom: 0,
	fit: true,
	pageNumber: null,
	expanded: false
};
var PDFOutline = class PDFOutline {
	constructor(document, parent, title, dest, options = DEFAULT_OPTIONS) {
		this.document = document;
		this.options = options;
		this.outlineData = {};
		if (dest !== null) {
			const destWidth = dest.data.MediaBox[2];
			const top = dest.data.MediaBox[3] - (options.top || 0);
			const left = destWidth - (options.left || 0);
			const zoom = options.zoom || 0;
			this.outlineData["Dest"] = options.fit ? [dest, "Fit"] : [
				dest,
				"XYZ",
				left,
				top,
				zoom
			];
		}
		if (parent !== null) this.outlineData["Parent"] = parent;
		if (title !== null) this.outlineData["Title"] = new String(title);
		this.dictionary = this.document.ref(this.outlineData);
		this.children = [];
	}
	addItem(title, options = DEFAULT_OPTIONS) {
		const pages = this.document._root.data.Pages.data.Kids;
		const dest = options.pageNumber != null ? pages[options.pageNumber] : this.document.page.dictionary;
		const result = new PDFOutline(this.document, this.dictionary, title, dest, options);
		this.children.push(result);
		return result;
	}
	endOutline() {
		if (this.children.length > 0) {
			if (this.options.expanded) this.outlineData.Count = this.children.length;
			const first = this.children[0], last = this.children[this.children.length - 1];
			this.outlineData.First = first.dictionary;
			this.outlineData.Last = last.dictionary;
			for (let i = 0, len = this.children.length; i < len; i++) {
				const child = this.children[i];
				if (i > 0) child.outlineData.Prev = this.children[i - 1].dictionary;
				if (i < this.children.length - 1) child.outlineData.Next = this.children[i + 1].dictionary;
				child.endOutline();
			}
		}
		return this.dictionary.end();
	}
};
var OutlineMixin = {
	initOutline() {
		this.outline = new PDFOutline(this, null, null, null);
	},
	endOutline() {
		this.outline.endOutline();
		if (this.outline.children.length > 0) {
			this._root.data.Outlines = this.outline.dictionary;
			return this._root.data.PageMode = this._root.data.PageMode || "UseOutlines";
		}
	}
};
var PDFStructureContent = class {
	constructor(pageRef, mcid) {
		this.refs = [{
			pageRef,
			mcid
		}];
	}
	push(structContent) {
		structContent.refs.forEach((ref) => this.refs.push(ref));
	}
};
var PDFStructureElement = class PDFStructureElement {
	constructor(document, type, options = {}, children = null) {
		this.document = document;
		this._attached = false;
		this._ended = false;
		this._flushed = false;
		this.dictionary = document.ref({ S: type });
		const data = this.dictionary.data;
		if (Array.isArray(options) || this._isValidChild(options)) {
			children = options;
			options = {};
		}
		if (options.title) data.T = new String(options.title);
		if (options.lang) data.Lang = new String(options.lang);
		if (options.alt) data.Alt = new String(options.alt);
		if (options.expanded) data.E = new String(options.expanded);
		if (options.actual) data.ActualText = new String(options.actual);
		const hasBbox = Array.isArray(options.bbox) && options.bbox.length === 4;
		const hasPlacement = typeof options.placement === "string";
		if (hasBbox || hasPlacement) {
			const attrs = { O: "Layout" };
			attrs.Placement = hasPlacement ? options.placement : "Block";
			if (hasBbox) {
				const height = document.page.height;
				attrs.BBox = [
					options.bbox[0],
					height - options.bbox[3],
					options.bbox[2],
					height - options.bbox[1]
				];
			}
			data.A = attrs;
		}
		if (options.scope) data.A = {
			...data.A || {},
			O: "Table",
			Scope: options.scope
		};
		this._children = [];
		if (children) {
			if (!Array.isArray(children)) children = [children];
			children.forEach((child) => this.add(child));
			this.end();
		}
	}
	add(child) {
		if (this._ended) throw new Error(`Cannot add child to already-ended structure element`);
		if (!this._isValidChild(child)) throw new Error(`Invalid structure element child`);
		if (child instanceof PDFStructureElement) {
			child.setParent(this.dictionary);
			if (this._attached) child.setAttached();
		}
		if (child instanceof PDFStructureContent) this._addContentToParentTree(child);
		if (child instanceof PDFAnnotationReference) this._addAnnotationToParentTree(child.annotationRef);
		if (typeof child === "function" && this._attached) child = this._contentForClosure(child);
		this._children.push(child);
		return this;
	}
	_addContentToParentTree(content) {
		content.refs.forEach(({ pageRef, mcid }) => {
			const pageStructParents = this.document.getStructParentTree().get(pageRef.data.StructParents);
			pageStructParents[mcid] = this.dictionary;
		});
	}
	_addAnnotationToParentTree(annotRef) {
		const parentTreeKey = this.document.createStructParentTreeNextKey();
		annotRef.data.StructParent = parentTreeKey;
		this.document.getStructParentTree().add(parentTreeKey, this.dictionary);
	}
	setParent(parentRef) {
		if (this.dictionary.data.P) throw new Error(`Structure element added to more than one parent`);
		this.dictionary.data.P = parentRef;
		this._flush();
	}
	setAttached() {
		if (this._attached) return;
		this._children.forEach((child, index) => {
			if (child instanceof PDFStructureElement) child.setAttached();
			if (typeof child === "function") this._children[index] = this._contentForClosure(child);
		});
		this._attached = true;
		this._flush();
	}
	end() {
		if (this._ended) return;
		this._children.filter((child) => child instanceof PDFStructureElement).forEach((child) => child.end());
		this._ended = true;
		this._flush();
	}
	_isValidChild(child) {
		return child instanceof PDFStructureElement || child instanceof PDFStructureContent || child instanceof PDFAnnotationReference || typeof child === "function";
	}
	_contentForClosure(closure) {
		const content = this.document.markStructureContent(this.dictionary.data.S);
		const prevStructElement = this.document._currentStructureElement;
		this.document._currentStructureElement = this;
		const wasEnded = this._ended;
		this._ended = false;
		closure();
		this._ended = wasEnded;
		this.document._currentStructureElement = prevStructElement;
		this.document.endMarkedContent();
		this._addContentToParentTree(content);
		return content;
	}
	_isFlushable() {
		if (!this.dictionary.data.P || !this._ended) return false;
		return this._children.every((child) => {
			if (typeof child === "function") return false;
			if (child instanceof PDFStructureElement) return child._isFlushable();
			return true;
		});
	}
	_flush() {
		if (this._flushed || !this._isFlushable()) return;
		this.dictionary.data.K = [];
		this._children.forEach((child) => this._flushChild(child));
		this.dictionary.end();
		this._children = [];
		this.dictionary.data.K = null;
		this._flushed = true;
	}
	_flushChild(child) {
		if (child instanceof PDFStructureElement) this.dictionary.data.K.push(child.dictionary);
		if (child instanceof PDFStructureContent) child.refs.forEach(({ pageRef, mcid }) => {
			if (!this.dictionary.data.Pg) this.dictionary.data.Pg = pageRef;
			if (this.dictionary.data.Pg === pageRef) this.dictionary.data.K.push(mcid);
			else this.dictionary.data.K.push({
				Type: "MCR",
				Pg: pageRef,
				MCID: mcid
			});
		});
		if (child instanceof PDFAnnotationReference) {
			const pageRef = this.document.page.dictionary;
			const objr = {
				Type: "OBJR",
				Obj: child.annotationRef,
				Pg: pageRef
			};
			this.dictionary.data.K.push(objr);
		}
	}
};
var PDFNumberTree = class extends PDFTree {
	_compareKeys(a, b) {
		return parseInt(a) - parseInt(b);
	}
	_keysName() {
		return "Nums";
	}
	_dataForKey(k) {
		return parseInt(k);
	}
};
var MarkingsMixin = {
	initMarkings(options) {
		this.structChildren = [];
		if (options.tagged) {
			this.getMarkInfoDictionary().data.Marked = true;
			this.getStructTreeRoot();
		}
	},
	markContent(tag, options = null) {
		if (tag === "Artifact" || options && options.mcid) {
			let toClose = 0;
			this.page.markings.forEach((marking) => {
				if (toClose || marking.structContent || marking.tag === "Artifact") toClose++;
			});
			while (toClose--) this.endMarkedContent();
		}
		if (!options) {
			this.page.markings.push({ tag });
			this.addContent(`/${tag} BMC`);
			return this;
		}
		this.page.markings.push({
			tag,
			options
		});
		const dictionary = {};
		if (typeof options.mcid !== "undefined") dictionary.MCID = options.mcid;
		if (tag === "Artifact") {
			if (typeof options.type === "string") dictionary.Type = options.type;
			if (Array.isArray(options.bbox)) dictionary.BBox = [
				options.bbox[0],
				this.page.height - options.bbox[3],
				options.bbox[2],
				this.page.height - options.bbox[1]
			];
			if (Array.isArray(options.attached) && options.attached.every((val) => typeof val === "string")) dictionary.Attached = options.attached;
		}
		if (tag === "Span") {
			if (options.lang) dictionary.Lang = new String(options.lang);
			if (options.alt) dictionary.Alt = new String(options.alt);
			if (options.expanded) dictionary.E = new String(options.expanded);
			if (options.actual) dictionary.ActualText = new String(options.actual);
		}
		this.addContent(`/${tag} ${PDFObject.convert(dictionary)} BDC`);
		return this;
	},
	markStructureContent(tag, options = {}) {
		const pageStructParents = this.getStructParentTree().get(this.page.structParentTreeKey);
		const mcid = pageStructParents.length;
		pageStructParents.push(null);
		this.markContent(tag, {
			...options,
			mcid
		});
		const structContent = new PDFStructureContent(this.page.dictionary, mcid);
		this.page.markings.slice(-1)[0].structContent = structContent;
		return structContent;
	},
	endMarkedContent() {
		this.page.markings.pop();
		this.addContent("EMC");
		if (this._textOptions) {
			delete this._textOptions.link;
			delete this._textOptions.goTo;
			delete this._textOptions.destination;
			delete this._textOptions.underline;
			delete this._textOptions.strike;
		}
		return this;
	},
	struct(type, options = {}, children = null) {
		return new PDFStructureElement(this, type, options, children);
	},
	addStructure(structElem) {
		const structTreeRoot = this.getStructTreeRoot();
		structElem.setParent(structTreeRoot);
		structElem.setAttached();
		this.structChildren.push(structElem);
		if (!structTreeRoot.data.K) structTreeRoot.data.K = [];
		structTreeRoot.data.K.push(structElem.dictionary);
		return this;
	},
	initPageMarkings(pageMarkings) {
		pageMarkings.forEach((marking) => {
			if (marking.structContent) {
				const structContent = marking.structContent;
				const newStructContent = this.markStructureContent(marking.tag, marking.options);
				structContent.push(newStructContent);
				this.page.markings.slice(-1)[0].structContent = structContent;
			} else this.markContent(marking.tag, marking.options);
		});
	},
	endPageMarkings(page) {
		const pageMarkings = page.markings;
		pageMarkings.forEach(() => page.write("EMC"));
		page.markings = [];
		return pageMarkings;
	},
	getMarkInfoDictionary() {
		if (!this._root.data.MarkInfo) this._root.data.MarkInfo = this.ref({});
		return this._root.data.MarkInfo;
	},
	hasMarkInfoDictionary() {
		return !!this._root.data.MarkInfo;
	},
	getStructTreeRoot() {
		if (!this._root.data.StructTreeRoot) this._root.data.StructTreeRoot = this.ref({
			Type: "StructTreeRoot",
			ParentTree: new PDFNumberTree(),
			ParentTreeNextKey: 0
		});
		return this._root.data.StructTreeRoot;
	},
	getStructParentTree() {
		return this.getStructTreeRoot().data.ParentTree;
	},
	createStructParentTreeNextKey() {
		this.getMarkInfoDictionary();
		const structTreeRoot = this.getStructTreeRoot();
		const key = structTreeRoot.data.ParentTreeNextKey++;
		structTreeRoot.data.ParentTree.add(key, []);
		return key;
	},
	endMarkings() {
		const structTreeRoot = this._root.data.StructTreeRoot;
		if (structTreeRoot) {
			structTreeRoot.end();
			this.structChildren.forEach((structElem) => structElem.end());
		}
		if (this._root.data.MarkInfo) this._root.data.MarkInfo.end();
	}
};
const FIELD_FLAGS = {
	readOnly: 1,
	required: 2,
	noExport: 4,
	multiline: 4096,
	password: 8192,
	toggleToOffButton: 16384,
	radioButton: 32768,
	pushButton: 65536,
	combo: 131072,
	edit: 262144,
	sort: 524288,
	multiSelect: 2097152,
	noSpell: 4194304
};
const FIELD_JUSTIFY = {
	left: 0,
	center: 1,
	right: 2
};
const VALUE_MAP = {
	value: "V",
	defaultValue: "DV"
};
const FORMAT_SPECIAL = {
	zip: "0",
	zipPlus4: "1",
	zip4: "1",
	phone: "2",
	ssn: "3"
};
const FORMAT_DEFAULT = {
	number: {
		nDec: 0,
		sepComma: false,
		negStyle: "MinusBlack",
		currency: "",
		currencyPrepend: true
	},
	percent: {
		nDec: 0,
		sepComma: false
	}
};
function mapTypeAndFlags(type, userOptions, pdfObject) {
	let flags = userOptions.Ff ?? 0;
	if (type === "text") pdfObject.FT = "Tx";
	else if (type === "pushButton") {
		pdfObject.FT = "Btn";
		flags |= FIELD_FLAGS.pushButton;
	} else if (type === "radioButton") {
		pdfObject.FT = "Btn";
		flags |= FIELD_FLAGS.radioButton;
	} else if (type === "checkbox") pdfObject.FT = "Btn";
	else if (type === "combo") {
		pdfObject.FT = "Ch";
		flags |= FIELD_FLAGS.combo;
	} else if (type === "list") pdfObject.FT = "Ch";
	else if (type) throw new Error(`Invalid form annotation type '${type}'`);
	Object.keys(userOptions).forEach((key) => {
		if (FIELD_FLAGS[key] && userOptions[key]) flags |= FIELD_FLAGS[key];
	});
	if (flags !== 0) pdfObject.Ff = flags;
}
function mapJustify(userOptions, pdfObject) {
	const result = FIELD_JUSTIFY[userOptions.align];
	if (typeof result === "number" && result !== 0) pdfObject.Q = result;
}
function mapStrings(options, pdfObject) {
	if (Array.isArray(options.select) && options.select.length) pdfObject.Opt = options.select.map((s) => {
		if (typeof s === "string") return new String(s);
		return s;
	});
	Object.keys(VALUE_MAP).forEach((key) => {
		if (key in options) {
			const value = options[key] ?? "";
			pdfObject[VALUE_MAP[key]] = typeof value === "string" ? new String(value) : value;
		}
	});
	if (options.MK?.CA) pdfObject.MK = { CA: new String(options.MK.CA) };
	if (options.label) {
		pdfObject.MK = options.MK ?? {};
		pdfObject.MK.CA = new String(options.label);
	}
}
function mapFormat(options, pdfObject) {
	const f = options.format;
	if (f?.type) {
		let fnKeystroke;
		let fnFormat;
		let params = "";
		if (FORMAT_SPECIAL[f.type] !== void 0) {
			fnKeystroke = `AFSpecial_Keystroke`;
			fnFormat = `AFSpecial_Format`;
			params = FORMAT_SPECIAL[f.type];
		} else {
			let format = f.type.charAt(0).toUpperCase() + f.type.slice(1);
			fnKeystroke = `AF${format}_Keystroke`;
			fnFormat = `AF${format}_Format`;
			if (f.type === "date") {
				fnKeystroke += "Ex";
				fnFormat += "Ex";
				params = "\"" + String(f.param) + "\"";
			} else if (f.type === "time") params = String(f.param);
			else if (f.type === "number") {
				let p = Object.assign({}, FORMAT_DEFAULT.number, f);
				params = String([
					String(p.nDec),
					p.sepComma ? "0" : "1",
					"\"" + p.negStyle + "\"",
					"null",
					"\"" + p.currency + "\"",
					String(p.currencyPrepend)
				].join(","));
			} else if (f.type === "percent") {
				let p = Object.assign({}, FORMAT_DEFAULT.percent, f);
				params = String([String(p.nDec), p.sepComma ? "0" : "1"].join(","));
			}
		}
		pdfObject.AA = options.AA ?? {};
		pdfObject.AA.K = {
			S: "JavaScript",
			JS: /* @__PURE__ */ new String(`${fnKeystroke}(${params});`)
		};
		pdfObject.AA.F = {
			S: "JavaScript",
			JS: /* @__PURE__ */ new String(`${fnFormat}(${params});`)
		};
	}
}
var AcroFormMixin = {
	initForm() {
		if (!this._font) throw new Error("Must set a font before calling initForm method");
		this._acroform = {
			fonts: {},
			defaultFont: this._font.name
		};
		this._acroform.fonts[this._font.id] = this._font.ref();
		let data = {
			Fields: [],
			NeedAppearances: true,
			DA: /* @__PURE__ */ new String(`/${this._font.id} 0 Tf 0 g`),
			DR: { Font: {} }
		};
		data.DR.Font[this._font.id] = this._font.ref();
		const AcroForm = this.ref(data);
		this._root.data.AcroForm = AcroForm;
		return this;
	},
	endAcroForm() {
		if (this._root.data.AcroForm) {
			if (!Object.keys(this._acroform.fonts).length && !this._acroform.defaultFont) throw new Error("No fonts specified for PDF form");
			let fontDict = this._root.data.AcroForm.data.DR.Font;
			Object.keys(this._acroform.fonts).forEach((name) => {
				fontDict[name] = this._acroform.fonts[name];
			});
			this._root.data.AcroForm.data.Fields.forEach((fieldRef) => {
				this._endChild(fieldRef);
			});
			this._root.data.AcroForm.end();
		}
		return this;
	},
	_endChild(ref) {
		if (Array.isArray(ref.data.Kids)) {
			ref.data.Kids.forEach((childRef) => {
				this._endChild(childRef);
			});
			ref.end();
		}
		return this;
	},
	formField(name, options = {}) {
		let fieldDict = this._fieldDict(name, null, options);
		let fieldRef = this.ref(fieldDict);
		this._addToParent(fieldRef);
		return fieldRef;
	},
	formAnnotation(name, type, x, y, w, h, options = {}) {
		let fieldDict = this._fieldDict(name, type, options);
		fieldDict.Subtype = "Widget";
		if (fieldDict.F === void 0) fieldDict.F = 4;
		this.annotate(x, y, w, h, fieldDict);
		let annotRef = this.page.annotations[this.page.annotations.length - 1];
		return this._addToParent(annotRef);
	},
	formText(name, x, y, w, h, options = {}) {
		return this.formAnnotation(name, "text", x, y, w, h, options);
	},
	formPushButton(name, x, y, w, h, options = {}) {
		return this.formAnnotation(name, "pushButton", x, y, w, h, options);
	},
	formCombo(name, x, y, w, h, options = {}) {
		return this.formAnnotation(name, "combo", x, y, w, h, options);
	},
	formList(name, x, y, w, h, options = {}) {
		return this.formAnnotation(name, "list", x, y, w, h, options);
	},
	formRadioButton(name, x, y, w, h, options = {}) {
		return this.formAnnotation(name, "radioButton", x, y, w, h, options);
	},
	formCheckbox(name, x, y, w, h, options = {}) {
		return this.formAnnotation(name, "checkbox", x, y, w, h, options);
	},
	_addToParent(fieldRef) {
		let parent = fieldRef.data.Parent;
		if (parent) {
			if (!parent.data.Kids) parent.data.Kids = [];
			parent.data.Kids.push(fieldRef);
		} else this._root.data.AcroForm.data.Fields.push(fieldRef);
		return this;
	},
	_fieldDict(name, type, options = {}) {
		if (!this._acroform) throw new Error("Call document.initForm() method before adding form elements to document");
		const pdfObject = {};
		mapTypeAndFlags(type, options, pdfObject);
		mapJustify(options, pdfObject);
		this._mapFont(options, pdfObject);
		mapStrings(options, pdfObject);
		this._mapColors(options, pdfObject);
		mapFormat(options, pdfObject);
		pdfObject.T = new String(name);
		if (options.parent) pdfObject.Parent = options.parent;
		return pdfObject;
	},
	_mapColors(options, pdfObject) {
		let color = this._normalizeColor(options.backgroundColor);
		if (color) {
			pdfObject.MK = pdfObject.MK ? pdfObject.MK : {};
			pdfObject.MK.BG = color;
		}
		color = this._normalizeColor(options.borderColor);
		if (color) {
			if (!pdfObject.MK) pdfObject.MK = {};
			pdfObject.MK.BC = color;
		}
	},
	_mapFont(options, pdfObject) {
		const { _acroform, _font } = this;
		if (_acroform.fonts[_font.id] == null) _acroform.fonts[_font.id] = _font.ref();
		if (_acroform.defaultFont !== _font.name) {
			pdfObject.DR = { Font: {} };
			const fontSize = options.fontSize || 0;
			pdfObject.DR.Font[_font.id] = _font.ref();
			pdfObject.DA = /* @__PURE__ */ new String(`/${_font.id} ${fontSize} Tf 0 g`);
		}
	}
};
var AttachmentsMixin = { file(src, options = {}) {
	options.name = options.name || src;
	options.relationship = options.relationship || "Unspecified";
	const refBody = {
		Type: "EmbeddedFile",
		Params: {}
	};
	let data;
	if (!src) throw new Error("No src specified");
	if (src instanceof Uint8Array) data = src;
	else if (src instanceof ArrayBuffer) data = new Uint8Array(src);
	else {
		const match = /^data:(.*?);base64,(.*)$/.exec(src);
		if (match) {
			if (match[1]) refBody.Subtype = escapeName(match[1]);
			data = fromBase64(match[2]);
		} else {
			data = fs.readFileSync(src);
			if (!data) throw new Error(`Could not read contents of file at filepath ${src}`);
			const { birthtime, ctime } = fs.statSync(src);
			refBody.Params.CreationDate = birthtime;
			refBody.Params.ModDate = ctime;
		}
	}
	if (options.creationDate instanceof Date) refBody.Params.CreationDate = options.creationDate;
	if (options.modifiedDate instanceof Date) refBody.Params.ModDate = options.modifiedDate;
	if (options.type) refBody.Subtype = escapeName(options.type);
	const checksum = md5Hex(new Uint8Array(data));
	refBody.Params.CheckSum = new String(checksum);
	refBody.Params.Size = data.byteLength;
	let ref;
	if (!this._fileRegistry) this._fileRegistry = {};
	let file = this._fileRegistry[options.name];
	if (file && isEqual(refBody, file)) ref = file.ref;
	else {
		ref = this.ref(refBody);
		ref.end(data);
		this._fileRegistry[options.name] = {
			...refBody,
			ref
		};
	}
	const fileSpecBody = {
		Type: "Filespec",
		AFRelationship: options.relationship,
		F: new String(options.name),
		EF: { F: ref },
		UF: new String(options.name)
	};
	if (options.description) fileSpecBody.Desc = new String(options.description);
	const filespec = this.ref(fileSpecBody);
	filespec.end();
	if (!options.hidden) this.addNamedEmbeddedFile(options.name, filespec);
	if (this._root.data.AF) this._root.data.AF.push(filespec);
	else this._root.data.AF = [filespec];
	return filespec;
} };
function isEqual(a, b) {
	return a.Subtype === b.Subtype && a.Params.CheckSum.toString() === b.Params.CheckSum.toString() && a.Params.Size === b.Params.Size && isSameDate(a.Params.CreationDate, b.Params.CreationDate) && isSameDate(a.Params.ModDate, b.Params.ModDate);
}
function isSameDate(a, b) {
	if (a === void 0 || b === void 0) return a === b;
	return a.getTime() === b.getTime();
}
const ICC_PROFILE_PATH = new URL("./data/sRGB_IEC61966_2_1.icc", import.meta.url).href;
let iccProfile;
var PDFA = {
	initPDFA(pSubset) {
		if (pSubset.charAt(pSubset.length - 3) === "-") {
			this.subset_conformance = pSubset.charAt(pSubset.length - 1).toUpperCase();
			this.subset = parseInt(pSubset.charAt(pSubset.length - 2));
		} else {
			this.subset_conformance = "B";
			this.subset = parseInt(pSubset.charAt(pSubset.length - 1));
		}
	},
	endSubset() {
		this._addPdfaMetadata();
		this._addColorOutputIntent();
	},
	_addColorOutputIntent() {
		if (!iccProfile) iccProfile = fs.readFileSync(ICC_PROFILE_PATH);
		const colorProfileRef = this.ref({
			Length: iccProfile.length,
			N: 3
		});
		colorProfileRef.write(iccProfile);
		colorProfileRef.end();
		const intentRef = this.ref({
			Type: "OutputIntent",
			S: "GTS_PDFA1",
			Info: /* @__PURE__ */ new String("sRGB IEC61966-2.1"),
			OutputConditionIdentifier: /* @__PURE__ */ new String("sRGB IEC61966-2.1"),
			DestOutputProfile: colorProfileRef
		});
		intentRef.end();
		this._root.data.OutputIntents = [intentRef];
	},
	_getPdfaid() {
		return `
        <rdf:Description xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" rdf:about="">
            <pdfaid:part>${this.subset}</pdfaid:part>
            <pdfaid:conformance>${this.subset_conformance}</pdfaid:conformance>
        </rdf:Description>
        `;
	},
	_addPdfaMetadata() {
		this.appendXML(this._getPdfaid());
	}
};
var PDFUA = {
	initPDFUA() {
		this.subset = 1;
	},
	endSubset() {
		this._addPdfuaMetadata();
	},
	_addPdfuaMetadata() {
		this.appendXML(this._getPdfuaid());
	},
	_getPdfuaid() {
		return `
        <rdf:Description xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/" rdf:about="">
            <pdfuaid:part>${this.subset}</pdfuaid:part>
        </rdf:Description>
        `;
	}
};
var SubsetMixin = {
	_importSubset(subset) {
		Object.assign(this, subset);
	},
	initSubset(options) {
		switch (options.subset) {
			case "PDF/A-1":
			case "PDF/A-1a":
			case "PDF/A-1b":
			case "PDF/A-2":
			case "PDF/A-2a":
			case "PDF/A-2b":
			case "PDF/A-3":
			case "PDF/A-3a":
			case "PDF/A-3b":
				this._importSubset(PDFA);
				this.initPDFA(options.subset);
				break;
			case "PDF/UA":
				this._importSubset(PDFUA);
				this.initPDFUA();
		}
	}
};
const ROW_FIELDS = [
	"height",
	"minHeight",
	"maxHeight"
];
const COLUMN_FIELDS = [
	"width",
	"minWidth",
	"maxWidth"
];
function memoize(fn, maxSize) {
	const cache = /* @__PURE__ */ new Map();
	return function(...args) {
		const key = args[0];
		if (!cache.has(key)) {
			cache.set(key, fn(...args));
			if (cache.size > maxSize) cache.delete(cache.keys().next());
		}
		return cache.get(key);
	};
}
function isObject(item) {
	return item && typeof item === "object" && !Array.isArray(item);
}
function deepMerge(target, ...sources) {
	if (!isObject(target)) return target;
	target = deepClone(target);
	for (const source of sources) if (isObject(source)) {
		for (const key in source) if (isObject(source[key])) {
			if (!(key in target)) target[key] = {};
			target[key] = deepMerge(target[key], source[key]);
		} else if (source[key] !== void 0) target[key] = deepClone(source[key]);
	}
	return target;
}
function deepClone(obj) {
	let result = obj;
	if (obj && typeof obj == "object") {
		result = Array.isArray(obj) ? [] : {};
		for (const key in obj) result[key] = deepClone(obj[key]);
	}
	return result;
}
function normalizedDefaultStyle(defaultStyleInternal) {
	let defaultStyle = defaultStyleInternal;
	if (typeof defaultStyle !== "object") defaultStyle = { text: defaultStyle };
	const defaultRowStyle = Object.fromEntries(Object.entries(defaultStyle).filter(([k]) => ROW_FIELDS.includes(k)));
	const defaultColStyle = Object.fromEntries(Object.entries(defaultStyle).filter(([k]) => COLUMN_FIELDS.includes(k)));
	defaultStyle.padding = normalizeSides(defaultStyle.padding);
	defaultStyle.border = normalizeSides(defaultStyle.border);
	defaultStyle.borderColor = normalizeSides(defaultStyle.borderColor);
	defaultStyle.align = normalizeAlignment(defaultStyle.align);
	return {
		defaultStyle,
		defaultRowStyle,
		defaultColStyle
	};
}
function normalizedRowStyle(defaultRowStyle, rowStyleInternal, i) {
	let rowStyle = rowStyleInternal(i);
	if (rowStyle == null || typeof rowStyle !== "object") rowStyle = { height: rowStyle };
	rowStyle.padding = normalizeSides(rowStyle.padding);
	rowStyle.border = normalizeSides(rowStyle.border);
	rowStyle.borderColor = normalizeSides(rowStyle.borderColor);
	rowStyle.align = normalizeAlignment(rowStyle.align);
	rowStyle = deepMerge(defaultRowStyle, rowStyle);
	const document = this.document;
	const page = document.page;
	const contentHeight = page.contentHeight;
	if (rowStyle.height == null || rowStyle.height === "auto") rowStyle.height = "auto";
	else rowStyle.height = document.sizeToPoint(rowStyle.height, 0, page, contentHeight);
	rowStyle.minHeight = document.sizeToPoint(rowStyle.minHeight, 0, page, contentHeight);
	rowStyle.maxHeight = document.sizeToPoint(rowStyle.maxHeight, 0, page, contentHeight);
	return rowStyle;
}
function normalizedColumnStyle(defaultColStyle, colStyleInternal, i) {
	let colStyle = colStyleInternal(i);
	if (colStyle == null || typeof colStyle !== "object") colStyle = { width: colStyle };
	colStyle.padding = normalizeSides(colStyle.padding);
	colStyle.border = normalizeSides(colStyle.border);
	colStyle.borderColor = normalizeSides(colStyle.borderColor);
	colStyle.align = normalizeAlignment(colStyle.align);
	colStyle = deepMerge(defaultColStyle, colStyle);
	if (colStyle.width == null || colStyle.width === "*") colStyle.width = "*";
	else colStyle.width = this.document.sizeToPoint(colStyle.width, 0, this.document.page, this._maxWidth);
	colStyle.minWidth = this.document.sizeToPoint(colStyle.minWidth, 0, this.document.page, this._maxWidth);
	colStyle.maxWidth = this.document.sizeToPoint(colStyle.maxWidth, 0, this.document.page, this._maxWidth);
	return colStyle;
}
function normalizeAlignment(align) {
	return align == null || typeof align === "string" ? {
		x: align,
		y: align
	} : align;
}
function normalizeTable() {
	const doc = this.document;
	const opts = this.opts;
	let index = doc._tableIndex++;
	this._id = new String(opts.id ?? `table-${index}`);
	this._position = {
		x: doc.sizeToPoint(opts.position?.x, doc.x),
		y: doc.sizeToPoint(opts.position?.y, doc.y)
	};
	this._maxWidth = doc.sizeToPoint(opts.maxWidth, doc.page.width - doc.page.margins.right - this._position.x);
	const { defaultStyle, defaultColStyle, defaultRowStyle } = normalizedDefaultStyle(opts.defaultStyle);
	this._defaultStyle = defaultStyle;
	let colStyle;
	if (opts.columnStyles) {
		if (Array.isArray(opts.columnStyles)) colStyle = (i) => opts.columnStyles[i];
		else if (typeof opts.columnStyles === "function") colStyle = memoize((i) => opts.columnStyles(i), Infinity);
		else if (typeof opts.columnStyles === "object") colStyle = () => opts.columnStyles;
	}
	if (!colStyle) colStyle = () => ({});
	this._colStyle = normalizedColumnStyle.bind(this, defaultColStyle, colStyle);
	let rowStyle;
	if (opts.rowStyles) {
		if (Array.isArray(opts.rowStyles)) rowStyle = (i) => opts.rowStyles[i];
		else if (typeof opts.rowStyles === "function") rowStyle = memoize((i) => opts.rowStyles(i), 10);
		else if (typeof opts.rowStyles === "object") rowStyle = () => opts.rowStyles;
	}
	if (!rowStyle) rowStyle = () => ({});
	this._rowStyle = normalizedRowStyle.bind(this, defaultRowStyle, rowStyle);
}
function normalizeText(text) {
	if (text != null) text = `${text}`;
	return text;
}
function normalizeCell(cell, rowIndex, colIndex) {
	const colStyle = this._colStyle(colIndex);
	let rowStyle = this._rowStyle(rowIndex);
	const font = {};
	for (const level of [
		colStyle.font,
		rowStyle.font,
		cell.font
	]) {
		if (level == null) continue;
		if (level.src != null) {
			font.src = level.src;
			font.family = level.family;
		} else if (level.family != null) font.family = level.family;
		if (level.size != null) font.size = level.size;
	}
	const customFont = Object.values(font).filter((v) => v != null).length > 0;
	const doc = this.document;
	const rollbackFont = doc._fontSource;
	const rollbackFontSize = doc._fontSize;
	const rollbackFontFamily = doc._fontFamily;
	if (customFont) {
		if (font.src) doc.font(font.src, font.family);
		if (font.size) doc.fontSize(font.size);
		rowStyle = this._rowStyle(rowIndex);
	}
	cell.padding = normalizeSides(cell.padding);
	cell.border = normalizeSides(cell.border);
	cell.borderColor = normalizeSides(cell.borderColor);
	const config = deepMerge(this._defaultStyle, colStyle, rowStyle, cell);
	config.rowIndex = rowIndex;
	config.colIndex = colIndex;
	config.font = font ?? {};
	config.customFont = customFont;
	config.text = normalizeText(config.text);
	config.rowSpan = config.rowSpan ?? 1;
	config.colSpan = config.colSpan ?? 1;
	config.padding = normalizeSides(config.padding, "0.25em", (x) => doc.sizeToPoint(x, "0.25em"));
	config.border = normalizeSides(config.border, 1, (x) => doc.sizeToPoint(x, 1));
	config.borderColor = normalizeSides(config.borderColor, "black", (x) => x ?? "black");
	config.align = normalizeAlignment(config.align);
	config.align.x = config.align.x ?? "left";
	config.align.y = config.align.y ?? "top";
	config.textStroke = doc.sizeToPoint(config.textStroke, 0);
	config.textStrokeColor = config.textStrokeColor ?? "black";
	config.textColor = config.textColor ?? "black";
	config.textOptions = config.textOptions ?? {};
	config.id = new String(config.id ?? `${this._id}-${rowIndex}-${colIndex}`);
	config.type = config.type?.toUpperCase() === "TH" ? "TH" : "TD";
	if (config.scope) {
		config.scope = config.scope.toLowerCase();
		if (config.scope === "row") config.scope = "Row";
		else if (config.scope === "both") config.scope = "Both";
		else if (config.scope === "column") config.scope = "Column";
	}
	if (typeof this.opts.debug === "boolean") config.debug = this.opts.debug;
	if (customFont) doc.font(rollbackFont, rollbackFontFamily, rollbackFontSize);
	return config;
}
function normalizeRow(row, rowIndex) {
	if (!this._cellClaim) this._cellClaim = /* @__PURE__ */ new Set();
	let colIndex = 0;
	return row.map((cell) => {
		if (cell == null || typeof cell !== "object") cell = { text: cell };
		while (this._cellClaim.has(`${rowIndex},${colIndex}`)) colIndex++;
		cell = normalizeCell.call(this, cell, rowIndex, colIndex);
		for (let i = 0; i < cell.rowSpan; i++) for (let j = 0; j < cell.colSpan; j++) this._cellClaim.add(`${rowIndex + i},${colIndex + j}`);
		colIndex += cell.colSpan;
		return cell;
	});
}
function ensure(row) {
	this._columnWidths = [];
	ensureColumnWidths.call(this, row.reduce((a, cell) => a + cell.colSpan, 0));
	this._rowHeights = [];
	this._rowYPos = [this._position.y];
	this._rowBuffer = /* @__PURE__ */ new Set();
}
function ensureColumnWidths(numCols) {
	let starColumnIndexes = [];
	let starMinAcc = 0;
	let unclaimedWidth = this._maxWidth;
	for (let i = 0; i < numCols; i++) {
		let col = this._colStyle(i);
		if (col.width === "*") {
			starColumnIndexes[i] = col;
			starMinAcc += col.minWidth;
		} else {
			unclaimedWidth -= col.width;
			this._columnWidths[i] = col.width;
		}
	}
	let starColCount = starColumnIndexes.reduce((x) => x + 1, 0);
	if (starMinAcc >= unclaimedWidth) starColumnIndexes.forEach((cell, i) => {
		this._columnWidths[i] = cell.minWidth;
	});
	else if (starColCount > 0) starColumnIndexes.forEach((col, i) => {
		let starSize = unclaimedWidth / starColCount;
		this._columnWidths[i] = Math.max(starSize, col.minWidth);
		if (col.maxWidth > 0) this._columnWidths[i] = Math.min(this._columnWidths[i], col.maxWidth);
		unclaimedWidth -= this._columnWidths[i];
		starColCount--;
	});
	let tempX = this._position.x;
	this._columnXPos = Array.from(this._columnWidths, (v) => {
		const t = tempX;
		tempX += v;
		return t;
	});
}
function measure(row, rowIndex) {
	row.forEach((cell) => this._rowBuffer.add(cell));
	if (rowIndex > 0) this._rowYPos[rowIndex] = this._rowYPos[rowIndex - 1] + this._rowHeights[rowIndex - 1];
	const rowStyle = this._rowStyle(rowIndex);
	let toRender = [];
	this._rowBuffer.forEach((cell) => {
		if (cell.rowIndex + cell.rowSpan - 1 === rowIndex) {
			toRender.push(measureCell.call(this, cell, rowStyle.height));
			this._rowBuffer.delete(cell);
		}
	});
	let rowHeight = rowStyle.height;
	if (rowHeight === "auto") rowHeight = toRender.reduce((acc, cell) => {
		let minHeight = cell.textBounds.height + cell.padding.top + cell.padding.bottom;
		for (let i = 0; i < cell.rowSpan - 1; i++) minHeight -= this._rowHeights[cell.rowIndex + i];
		return Math.max(acc, minHeight);
	}, 0);
	rowHeight = Math.max(rowHeight, rowStyle.minHeight);
	if (rowStyle.maxHeight > 0) rowHeight = Math.min(rowHeight, rowStyle.maxHeight);
	this._rowHeights[rowIndex] = rowHeight;
	let newPage = false;
	if (rowHeight > this.document.page.contentHeight) {
		console.warn((/* @__PURE__ */ new Error(`Row ${rowIndex} requested more than the safe page height, row has been clamped`)).stack.slice(7));
		this._rowHeights[rowIndex] = this.document.page.maxY() - this._rowYPos[rowIndex];
	} else if (this._rowYPos[rowIndex] + rowHeight >= this.document.page.maxY()) {
		this._rowYPos[rowIndex] = this.document.page.margins.top;
		newPage = true;
	}
	return {
		newPage,
		toRender: toRender.map((cell) => measureCell.call(this, cell, rowHeight))
	};
}
function measureCell(cell, rowHeight) {
	let cellWidth = 0;
	for (let i = 0; i < cell.colSpan; i++) cellWidth += this._columnWidths[cell.colIndex + i];
	let cellHeight = rowHeight;
	if (cellHeight === "auto") cellHeight = this.document.page.contentHeight;
	else for (let i = 0; i < cell.rowSpan - 1; i++) cellHeight += this._rowHeights[cell.rowIndex + i];
	const textAllocatedWidth = cellWidth - cell.padding.left - cell.padding.right;
	const textAllocatedHeight = cellHeight - cell.padding.top - cell.padding.bottom;
	const rotation = cell.textOptions.rotation ?? 0;
	const { width: textMaxWidth, height: textMaxHeight } = computeBounds(rotation, textAllocatedWidth, textAllocatedHeight);
	const textOptions = {
		align: cell.align.x,
		ellipsis: true,
		stroke: cell.textStroke > 0,
		fill: true,
		width: textMaxWidth,
		height: textMaxHeight,
		rotation,
		...cell.textOptions
	};
	let textBounds = {
		x: 0,
		y: 0,
		width: 0,
		height: 0
	};
	if (cell.text) {
		const rollbackFont = this.document._fontSource;
		const rollbackFontSize = this.document._fontSize;
		const rollbackFontFamily = this.document._fontFamily;
		if (cell.font?.src) this.document.font(cell.font.src, cell.font?.family);
		if (cell.font?.size) this.document.fontSize(cell.font.size);
		const unRotatedTextBounds = this.document.boundsOfString(cell.text, 0, 0, {
			...textOptions,
			rotation: 0
		});
		textOptions.width = unRotatedTextBounds.width;
		textOptions.height = unRotatedTextBounds.height;
		textBounds = this.document.boundsOfString(cell.text, 0, 0, textOptions);
		this.document.font(rollbackFont, rollbackFontFamily, rollbackFontSize);
	}
	return {
		...cell,
		textOptions,
		x: this._columnXPos[cell.colIndex],
		y: this._rowYPos[cell.rowIndex],
		textX: this._columnXPos[cell.colIndex] + cell.padding.left,
		textY: this._rowYPos[cell.rowIndex] + cell.padding.top,
		width: cellWidth,
		height: cellHeight,
		textAllocatedHeight,
		textAllocatedWidth,
		textBounds
	};
}
function computeBounds(rotation, allocWidth, allocHeight) {
	let textMaxWidth, textMaxHeight;
	const cos = cosine(rotation);
	const sin = sine(rotation);
	if (rotation === 0 || rotation === 180) {
		textMaxWidth = allocWidth;
		textMaxHeight = allocHeight;
	} else if (rotation === 90 || rotation === 270) {
		textMaxWidth = allocHeight;
		textMaxHeight = allocWidth;
	} else if (rotation < 90 || rotation > 180 && rotation < 270) {
		textMaxWidth = allocWidth / (2 * cos);
		textMaxHeight = allocWidth / (2 * sin);
	} else {
		textMaxHeight = allocWidth / (2 * cos);
		textMaxWidth = allocWidth / (2 * sin);
	}
	if (sin * textMaxWidth + cos * textMaxHeight > allocHeight) {
		const denominator = cos * cos - sin * sin;
		if (rotation === 0 || rotation === 180) {
			textMaxWidth = allocWidth;
			textMaxHeight = allocHeight;
		} else if (rotation === 90 || rotation === 270) {
			textMaxWidth = allocHeight;
			textMaxHeight = allocWidth;
		} else if (rotation < 90 || rotation > 180 && rotation < 270) {
			textMaxWidth = (allocWidth * cos - allocHeight * sin) / denominator;
			textMaxHeight = (allocHeight * cos - allocWidth * sin) / denominator;
		} else {
			textMaxHeight = (allocWidth * cos - allocHeight * sin) / denominator;
			textMaxWidth = (allocHeight * cos - allocWidth * sin) / denominator;
		}
	}
	return {
		width: Math.abs(textMaxWidth),
		height: Math.abs(textMaxHeight)
	};
}
function accommodateTable() {
	const structParent = this.opts.structParent;
	if (structParent) {
		this._tableStruct = this.document.struct("Table");
		this._tableStruct.dictionary.data.ID = this._id;
		if (structParent instanceof PDFStructureElement) structParent.add(this._tableStruct);
		else if (structParent instanceof PDFDocument) structParent.addStructure(this._tableStruct);
		this._headerRowLookup = {};
		this._headerColumnLookup = {};
	}
}
function accommodateCleanup() {
	if (this._tableStruct) this._tableStruct.end();
}
function accessibleRow(row, rowIndex, renderCell) {
	const rowStruct = this.document.struct("TR");
	rowStruct.dictionary.data.ID = /* @__PURE__ */ new String(`${this._id}-${rowIndex}`);
	this._tableStruct.add(rowStruct);
	row.forEach((cell) => renderCell(cell, rowStruct));
	rowStruct.end();
}
function accessibleCell(cell, rowStruct, callback) {
	const doc = this.document;
	const cellStruct = doc.struct(cell.type, { title: cell.title });
	cellStruct.dictionary.data.ID = cell.id;
	rowStruct.add(cellStruct);
	const padding = cell.padding;
	const border = cell.border;
	const attributes = {
		O: "Table",
		Width: cell.width,
		Height: cell.height,
		Padding: [
			padding.top,
			padding.bottom,
			padding.left,
			padding.right
		],
		RowSpan: cell.rowSpan > 1 ? cell.rowSpan : void 0,
		ColSpan: cell.colSpan > 1 ? cell.colSpan : void 0,
		BorderThickness: [
			border.top,
			border.bottom,
			border.left,
			border.right
		]
	};
	if (cell.type === "TH") {
		if (cell.scope === "Row" || cell.scope === "Both") {
			for (let i = 0; i < cell.rowSpan; i++) {
				if (!this._headerRowLookup[cell.rowIndex + i]) this._headerRowLookup[cell.rowIndex + i] = [];
				this._headerRowLookup[cell.rowIndex + i].push(cell.id);
			}
			attributes.Scope = cell.scope;
		}
		if (cell.scope === "Column" || cell.scope === "Both") {
			for (let i = 0; i < cell.colSpan; i++) {
				if (!this._headerColumnLookup[cell.colIndex + i]) this._headerColumnLookup[cell.colIndex + i] = [];
				this._headerColumnLookup[cell.colIndex + i].push(cell.id);
			}
			attributes.Scope = cell.scope;
		}
	}
	const Headers = new Set([...Array.from({ length: cell.colSpan }, (_, i) => this._headerColumnLookup[cell.colIndex + i]).flat(), ...Array.from({ length: cell.rowSpan }, (_, i) => this._headerRowLookup[cell.rowIndex + i]).flat()].filter(Boolean));
	if (Headers.size) attributes.Headers = Array.from(Headers);
	const normalizeColor = doc._normalizeColor;
	if (cell.backgroundColor != null) attributes.BackgroundColor = normalizeColor(cell.backgroundColor);
	const hasBorder = [
		border.top,
		border.bottom,
		border.left,
		border.right
	];
	if (hasBorder.some((x) => x)) {
		const borderColor = cell.borderColor;
		attributes.BorderColor = [
			hasBorder[0] ? normalizeColor(borderColor.top) : null,
			hasBorder[1] ? normalizeColor(borderColor.bottom) : null,
			hasBorder[2] ? normalizeColor(borderColor.left) : null,
			hasBorder[3] ? normalizeColor(borderColor.right) : null
		];
	}
	Object.keys(attributes).forEach((key) => attributes[key] === void 0 && delete attributes[key]);
	cellStruct.dictionary.data.A = doc.ref(attributes);
	cellStruct.add(callback);
	cellStruct.end();
	cellStruct.dictionary.data.A.end();
}
function renderRow(row, rowIndex) {
	if (this._tableStruct) accessibleRow.call(this, row, rowIndex, renderCell.bind(this));
	else row.forEach((cell) => renderCell.call(this, cell));
	return this._rowYPos[rowIndex] + this._rowHeights[rowIndex];
}
function renderCell(cell, rowStruct) {
	const cellRenderer = () => {
		if (cell.backgroundColor != null) this.document.save().fillColor(cell.backgroundColor).rect(cell.x, cell.y, cell.width, cell.height).fill().restore();
		renderBorder.call(this, cell.border, cell.borderColor, cell.x, cell.y, cell.width, cell.height);
		if (cell.debug) {
			this.document.save();
			this.document.dash(1, { space: 1 }).lineWidth(1).strokeOpacity(.3);
			this.document.rect(cell.x, cell.y, cell.width, cell.height).stroke("green");
			this.document.restore();
		}
		if (cell.text) renderCellText.call(this, cell);
	};
	if (rowStruct) accessibleCell.call(this, cell, rowStruct, cellRenderer);
	else cellRenderer();
}
function renderCellText(cell) {
	const doc = this.document;
	const rollbackFont = doc._fontSource;
	const rollbackFontSize = doc._fontSize;
	const rollbackFontFamily = doc._fontFamily;
	if (cell.customFont) {
		if (cell.font.src) doc.font(cell.font.src, cell.font.family);
		if (cell.font.size) doc.fontSize(cell.font.size);
	}
	const x = cell.textX;
	const y = cell.textY;
	const Ah = cell.textAllocatedHeight;
	const Aw = cell.textAllocatedWidth;
	const Cw = cell.textBounds.width;
	const Ch = cell.textBounds.height;
	const Ox = -cell.textBounds.x;
	const Oy = -cell.textBounds.y;
	const PxScale = cell.align.x === "right" ? 1 : cell.align.x === "center" ? .5 : 0;
	const Px = (Aw - Cw) * PxScale;
	const PyScale = cell.align.y === "bottom" ? 1 : cell.align.y === "center" ? .5 : 0;
	const Py = (Ah - Ch) * PyScale;
	const dx = Px + Ox;
	const dy = Py + Oy;
	if (cell.debug) {
		doc.save();
		doc.dash(1, { space: 1 }).lineWidth(1).strokeOpacity(.3);
		if (cell.text) doc.moveTo(x + Px, y).lineTo(x + Px, y + Ah).moveTo(x + Px + Cw, y).lineTo(x + Px + Cw, y + Ah).stroke("blue").moveTo(x, y + Py).lineTo(x + Aw, y + Py).moveTo(x, y + Py + Ch).lineTo(x + Aw, y + Py + Ch).stroke("green");
		doc.rect(x, y, Aw, Ah).stroke("orange");
		doc.restore();
	}
	doc.save().rect(x, y, Aw, Ah).clip();
	doc.fillColor(cell.textColor).strokeColor(cell.textStrokeColor);
	if (cell.textStroke > 0) doc.lineWidth(cell.textStroke);
	doc.text(cell.text, x + dx, y + dy, cell.textOptions);
	doc.restore();
	if (cell.font) doc.font(rollbackFont, rollbackFontFamily, rollbackFontSize);
}
function renderBorder(border, borderColor, x, y, width, height, mask) {
	border = Object.fromEntries(Object.entries(border).map(([k, v]) => [k, mask && !mask[k] ? 0 : v]));
	const doc = this.document;
	if ([
		border.right,
		border.bottom,
		border.left
	].every((val) => val === border.top)) {
		if (border.top > 0) doc.save().lineWidth(border.top).strokeColor(borderColor.top).rect(x, y, width, height).stroke().restore();
	} else {
		if (border.top > 0) doc.save().lineWidth(border.top).moveTo(x, y).strokeColor(borderColor.top).lineTo(x + width, y).stroke().restore();
		if (border.right > 0) doc.save().lineWidth(border.right).moveTo(x + width, y).strokeColor(borderColor.right).lineTo(x + width, y + height).stroke().restore();
		if (border.bottom > 0) doc.save().lineWidth(border.bottom).moveTo(x + width, y + height).strokeColor(borderColor.bottom).lineTo(x, y + height).stroke().restore();
		if (border.left > 0) doc.save().lineWidth(border.left).moveTo(x, y + height).strokeColor(borderColor.left).lineTo(x, y).stroke().restore();
	}
}
var PDFTable = class {
	constructor(document, opts = {}) {
		this.document = document;
		this.opts = Object.freeze(opts);
		normalizeTable.call(this);
		accommodateTable.call(this);
		this._currRowIndex = 0;
		this._ended = false;
		if (opts.data) {
			for (const row of opts.data) this.row(row);
			return this.end();
		}
	}
	row(row, lastRow = false) {
		if (this._ended) throw new Error(`Table was marked as ended on row ${this._currRowIndex}`);
		row = Array.from(row);
		row = normalizeRow.call(this, row, this._currRowIndex);
		if (this._currRowIndex === 0) ensure.call(this, row);
		const { newPage, toRender } = measure.call(this, row, this._currRowIndex);
		if (newPage) this.document.continueOnNewPage();
		const yPos = renderRow.call(this, toRender, this._currRowIndex);
		this.document.x = this._position.x;
		this.document.y = yPos;
		if (lastRow) return this.end();
		this._currRowIndex++;
		return this;
	}
	end() {
		while (this._rowBuffer?.size) this.row([]);
		this._ended = true;
		accommodateCleanup.call(this);
		return this.document;
	}
};
var TableMixin = {
	initTables() {
		this._tableIndex = 0;
	},
	table(opts) {
		return new PDFTable(this, opts);
	}
};
var PDFMetadata = class {
	constructor() {
		this._metadata = `
        <?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?>
            <x:xmpmeta xmlns:x="adobe:ns:meta/">
                <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
        `;
	}
	_closeTags() {
		this._metadata = this._metadata.concat(`
                </rdf:RDF>
            </x:xmpmeta>
        <?xpacket end="w"?>
        `);
	}
	append(xml, newline = true) {
		this._metadata = this._metadata.concat(xml);
		if (newline) this._metadata = this._metadata.concat("\n");
	}
	getXML() {
		return this._metadata;
	}
	getLength() {
		return this._metadata.length;
	}
	end() {
		this._closeTags();
		this._metadata = this._metadata.trim();
	}
};
var MetadataMixin = {
	initMetadata() {
		this.metadata = new PDFMetadata();
	},
	appendXML(xml, newline = true) {
		this.metadata.append(xml, newline);
	},
	_addInfo() {
		this.appendXML(`
        <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
            <xmp:CreateDate>${this.info.CreationDate.toISOString().split(".")[0] + "Z"}</xmp:CreateDate>
            <xmp:CreatorTool>${this.info.Creator}</xmp:CreatorTool>
        </rdf:Description>
        `);
		if (this.info.Title || this.info.Author || this.info.Subject) {
			this.appendXML(`
            <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
            `);
			if (this.info.Title) this.appendXML(`
                <dc:title>
                    <rdf:Alt>
                        <rdf:li xml:lang="x-default">${this.info.Title}</rdf:li>
                    </rdf:Alt>
                </dc:title>
                `);
			if (this.info.Author) this.appendXML(`
                <dc:creator>
                    <rdf:Seq>
                        <rdf:li>${this.info.Author}</rdf:li>
                    </rdf:Seq>
                </dc:creator>
                `);
			if (this.info.Subject) this.appendXML(`
                <dc:description>
                    <rdf:Alt>
                        <rdf:li xml:lang="x-default">${this.info.Subject}</rdf:li>
                    </rdf:Alt>
                </dc:description>
                `);
			this.appendXML(`
            </rdf:Description>
            `);
		}
		this.appendXML(`
        <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
            <pdf:Producer>${this.info.Producer}</pdf:Producer>`, false);
		if (this.info.Keywords) this.appendXML(`
            <pdf:Keywords>${this.info.Keywords}</pdf:Keywords>`, false);
		this.appendXML(`
        </rdf:Description>
        `);
	},
	endMetadata() {
		this._addInfo();
		this.metadata.end();
		if (this.version != 1.3) {
			this.metadataRef = this.ref({
				length: this.metadata.getLength(),
				Type: "Metadata",
				Subtype: "XML"
			});
			this.metadataRef.compress = false;
			this.metadataRef.write(new TextEncoder().encode(this.metadata.getXML()));
			this.metadataRef.end();
			this._root.data.Metadata = this.metadataRef;
		}
	}
};
var PDFDocument = class extends Readable {
	constructor(options = {}) {
		super(options);
		this.options = options;
		switch (options.pdfVersion) {
			case "1.4":
				this.version = 1.4;
				break;
			case "1.5":
				this.version = 1.5;
				break;
			case "1.6":
				this.version = 1.6;
				break;
			case "1.7":
			case "1.7ext3":
				this.version = 1.7;
				break;
			default: this.version = 1.3;
		}
		this.compress = this.options.compress != null ? this.options.compress : true;
		this._pageBuffer = [];
		this._pageBufferStart = 0;
		this._offsets = [];
		this._waiting = 0;
		this._ended = false;
		this._offset = 0;
		const Pages = this.ref({
			Type: "Pages",
			Count: 0,
			Kids: []
		});
		const Names = this.ref({ Dests: new PDFNameTree() });
		this._root = this.ref({
			Type: "Catalog",
			Pages,
			Names
		});
		if (this.options.lang) this._root.data.Lang = new String(this.options.lang);
		if (this.options.pageLayout) {
			const layout = this.options.pageLayout;
			this._root.data.PageLayout = layout.charAt(0).toUpperCase() + layout.slice(1);
		}
		this.page = null;
		this.initMetadata();
		this.initColor();
		this.initVector();
		this.initFonts(options.font);
		this.initText();
		this.initImages();
		this.initOutline();
		this.initMarkings(options);
		this.initTables();
		this.initSubset(options);
		this.info = {
			Producer: "PDFKit",
			Creator: "PDFKit",
			CreationDate: /* @__PURE__ */ new Date()
		};
		if (this.options.info) for (let key in this.options.info) {
			const val = this.options.info[key];
			this.info[key] = val;
		}
		if (this.options.displayTitle) this._root.data.ViewerPreferences = this.ref({ DisplayDocTitle: true });
		this._id = PDFSecurity.generateFileID(this.info);
		this._security = PDFSecurity.create(this, options);
		this._write(`%PDF-${this.version}`);
		this._write("%ÿÿÿÿ");
		if (this.options.autoFirstPage !== false) this.addPage();
	}
	addPage(options) {
		const documentOptions = this.options;
		if (!documentOptions.bufferPages) this.flushPages();
		const font = options?.font;
		if (font) this.font(font, options.fontFamily);
		const fontSize = options?.fontSize;
		if (fontSize) this.fontSize(fontSize);
		this.page = new PDFPage(this, options || documentOptions);
		this._pageBuffer.push(this.page);
		const pages = this._root.data.Pages.data;
		pages.Kids.push(this.page.dictionary);
		pages.Count++;
		this.x = this.page.margins.left;
		this.y = this.page.margins.top;
		this._ctm = [
			1,
			0,
			0,
			1,
			0,
			0
		];
		this.transform(1, 0, 0, -1, 0, this.page.height);
		this.emit("pageAdded");
		return this;
	}
	continueOnNewPage(options) {
		const pageMarkings = this.endPageMarkings(this.page);
		this.addPage(options ?? this.page._options);
		this.initPageMarkings(pageMarkings);
		return this;
	}
	bufferedPageRange() {
		return {
			start: this._pageBufferStart,
			count: this._pageBuffer.length
		};
	}
	switchToPage(n) {
		let page;
		if (!(page = this._pageBuffer[n - this._pageBufferStart])) throw new Error(`switchToPage(${n}) out of bounds, current buffer covers pages ${this._pageBufferStart} to ${this._pageBufferStart + this._pageBuffer.length - 1}`);
		return this.page = page;
	}
	flushPages() {
		const pages = this._pageBuffer;
		this._pageBuffer = [];
		this._pageBufferStart += pages.length;
		for (let page of pages) {
			this.endPageMarkings(page);
			page.end();
		}
	}
	addNamedDestination(name, ...args) {
		if (args.length === 0) args = [
			"XYZ",
			null,
			null,
			null
		];
		if (args[0] === "XYZ" && args[2] !== null) args[2] = this.page.height - args[2];
		args.unshift(this.page.dictionary);
		this._root.data.Names.data.Dests.add(name, args);
	}
	addNamedEmbeddedFile(name, ref) {
		if (!ref) throw new Error(`No ref specified for embedded file ${name}`);
		if (!this._root.data.Names.data.EmbeddedFiles) this._root.data.Names.data.EmbeddedFiles = new PDFNameTree({ limits: false });
		this._root.data.Names.data.EmbeddedFiles.add(name, ref);
	}
	addNamedJavaScript(name, js) {
		if (!this._root.data.Names.data.JavaScript) this._root.data.Names.data.JavaScript = new PDFNameTree();
		let data = {
			JS: new String(js),
			S: "JavaScript"
		};
		this._root.data.Names.data.JavaScript.add(name, data);
	}
	ref(data) {
		const ref = new PDFReference(this, this._offsets.length + 1, data);
		this._offsets.push(null);
		this._waiting++;
		return ref;
	}
	_read() {}
	_write(data) {
		if (!(data instanceof Uint8Array)) data = fromBinaryString(data + "\n");
		this.push(data);
		this._offset += data.length;
	}
	addContent(data) {
		this.page.write(data);
		return this;
	}
	_refEnd(ref) {
		this._offsets[ref.id - 1] = ref.offset;
		if (--this._waiting === 0 && this._ended) {
			this._finalize();
			this._ended = false;
		}
	}
	end() {
		this.flushPages();
		this._info = this.ref();
		for (let key in this.info) {
			let val = this.info[key];
			if (typeof val === "string") val = new String(val);
			let entry = this.ref(val);
			entry.end();
			this._info.data[key] = entry;
		}
		this._info.end();
		for (let name in this._fontFamilies) this._fontFamilies[name].finalize();
		this.endOutline();
		this.endMarkings();
		if (this.subset) this.endSubset();
		this.endMetadata();
		this._root.end();
		this._root.data.Pages.end();
		this._root.data.Names.end();
		this.endAcroForm();
		if (this._root.data.ViewerPreferences) this._root.data.ViewerPreferences.end();
		if (this._security) this._security.end();
		if (this._waiting === 0) this._finalize();
		else this._ended = true;
	}
	_finalize() {
		const xRefOffset = this._offset;
		this._write("xref");
		this._write(`0 ${this._offsets.length + 1}`);
		this._write("0000000000 65535 f ");
		for (let offset of this._offsets) {
			offset = `0000000000${offset}`.slice(-10);
			this._write(offset + " 00000 n ");
		}
		const trailer = {
			Size: this._offsets.length + 1,
			Root: this._root,
			Info: this._info,
			ID: [this._id, this._id]
		};
		if (this._security) trailer.Encrypt = this._security.dictionary;
		this._write("trailer");
		this._write(PDFObject.convert(trailer));
		this._write("startxref");
		this._write(`${xRefOffset}`);
		this._write("%%EOF");
		this.push(null);
	}
	toString() {
		return "[object PDFDocument]";
	}
};
const mixin = (methods) => {
	Object.assign(PDFDocument.prototype, methods);
};
mixin(MetadataMixin);
mixin(ColorMixin);
mixin(VectorMixin);
mixin(FontsMixin);
mixin(TextMixin);
mixin(ImagesMixin);
mixin(AnnotationsMixin);
mixin(OutlineMixin);
mixin(MarkingsMixin);
mixin(AcroFormMixin);
mixin(AttachmentsMixin);
mixin(SubsetMixin);
mixin(TableMixin);
const require$1 = createRequire(import.meta.url);
registerStdFontLoaders({
	Courier: () => require$1("#standard-fonts/Courier"),
	"Courier-Bold": () => require$1("#standard-fonts/CourierBold"),
	"Courier-BoldOblique": () => require$1("#standard-fonts/CourierBoldOblique"),
	"Courier-Oblique": () => require$1("#standard-fonts/CourierOblique"),
	Helvetica: () => require$1("#standard-fonts/Helvetica"),
	"Helvetica-Bold": () => require$1("#standard-fonts/HelveticaBold"),
	"Helvetica-BoldOblique": () => require$1("#standard-fonts/HelveticaBoldOblique"),
	"Helvetica-Oblique": () => require$1("#standard-fonts/HelveticaOblique"),
	Symbol: () => require$1("#standard-fonts/Symbol"),
	"Times-Bold": () => require$1("#standard-fonts/TimesBold"),
	"Times-BoldItalic": () => require$1("#standard-fonts/TimesBoldItalic"),
	"Times-Italic": () => require$1("#standard-fonts/TimesItalic"),
	"Times-Roman": () => require$1("#standard-fonts/TimesRoman"),
	ZapfDingbats: () => require$1("#standard-fonts/ZapfDingbats")
});
export { PDFDocument };
