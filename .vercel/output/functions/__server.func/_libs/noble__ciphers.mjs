import { createRequire as __wkfCreateRequire } from "node:module";
if (typeof require === "undefined") globalThis.require = __wkfCreateRequire(import.meta.url);
// node_modules/@noble/ciphers/esm/utils.js
/**
* Utilities for hex, bytes, CSPRNG.
* @module
*/
/*! noble-ciphers - MIT License (c) 2023 Paul Miller (paulmillr.com) */
/** Checks if something is Uint8Array. Be careful: nodejs Buffer will return true. */
function isBytes(a) {
	return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
/** Asserts something is Uint8Array. */
function abytes(b, ...lengths) {
	if (!isBytes(b)) throw new Error("Uint8Array expected");
	if (lengths.length > 0 && !lengths.includes(b.length)) throw new Error("Uint8Array expected of length " + lengths + ", got length=" + b.length);
}
/** Cast u8 / u16 / u32 to u32. */
function u32(arr) {
	return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
}
/** Zeroize a byte array. Warning: JS provides no guarantees. */
function clean(...arrays) {
	for (let i = 0; i < arrays.length; i++) arrays[i].fill(0);
}
/** Is current platform little-endian? Most are. Big-Endian platform: IBM */
const isLE = /* @__PURE__ */ (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
/**
* Checks if two U8A use same underlying buffer and overlaps.
* This is invalid and can corrupt data.
*/
function overlapBytes(a, b) {
	return a.buffer === b.buffer && a.byteOffset < b.byteOffset + b.byteLength && b.byteOffset < a.byteOffset + a.byteLength;
}
/**
* If input and output overlap and input starts before output, we will overwrite end of input before
* we start processing it, so this is not supported for most ciphers (except chacha/salse, which designed with this)
*/
function complexOverlapBytes(input, output) {
	if (overlapBytes(input, output) && input.byteOffset < output.byteOffset) throw new Error("complex overlap of input and output is not supported");
}
/**
* Wraps a cipher: validates args, ensures encrypt() can only be called once.
* @__NO_SIDE_EFFECTS__
*/
const wrapCipher = (params, constructor) => {
	function wrappedCipher(key, ...args) {
		abytes(key);
		if (!isLE) throw new Error("Non little-endian hardware is not yet supported");
		if (params.nonceLength !== void 0) {
			const nonce = args[0];
			if (!nonce) throw new Error("nonce / iv required");
			if (params.varSizeNonce) abytes(nonce);
			else abytes(nonce, params.nonceLength);
		}
		const tagl = params.tagLength;
		if (tagl && args[1] !== void 0) abytes(args[1]);
		const cipher = constructor(key, ...args);
		const checkOutput = (fnLength, output) => {
			if (output !== void 0) {
				if (fnLength !== 2) throw new Error("cipher output not supported");
				abytes(output);
			}
		};
		let called = false;
		return {
			encrypt(data, output) {
				if (called) throw new Error("cannot encrypt() twice with same key + nonce");
				called = true;
				abytes(data);
				checkOutput(cipher.encrypt.length, output);
				return cipher.encrypt(data, output);
			},
			decrypt(data, output) {
				abytes(data);
				if (tagl && data.length < tagl) throw new Error("invalid ciphertext length: smaller than tagLength=" + tagl);
				checkOutput(cipher.decrypt.length, output);
				return cipher.decrypt(data, output);
			}
		};
	}
	Object.assign(wrappedCipher, params);
	return wrappedCipher;
};
/**
* By default, returns u8a of length.
* When out is available, it checks it for validity and uses it.
*/
function getOutput(expectedLength, out, onlyAligned = true) {
	if (out === void 0) return new Uint8Array(expectedLength);
	if (out.length !== expectedLength) throw new Error("invalid output length, expected " + expectedLength + ", got: " + out.length);
	if (onlyAligned && !isAligned32(out)) throw new Error("invalid output, must be aligned");
	return out;
}
function isAligned32(bytes) {
	return bytes.byteOffset % 4 === 0;
}
function copyBytes(bytes) {
	return Uint8Array.from(bytes);
}
// node_modules/@noble/ciphers/esm/aes.js
const BLOCK_SIZE = 16;
const POLY = 283;
function mul2(n) {
	return n << 1 ^ POLY & -(n >> 7);
}
function mul(a, b) {
	let res = 0;
	for (; b > 0; b >>= 1) {
		res ^= a & -(b & 1);
		a = mul2(a);
	}
	return res;
}
const sbox = /* @__PURE__ */ (() => {
	const t = /* @__PURE__ */ new Uint8Array(256);
	for (let i = 0, x = 1; i < 256; i++, x ^= mul2(x)) t[i] = x;
	const box = /* @__PURE__ */ new Uint8Array(256);
	box[0] = 99;
	for (let i = 0; i < 255; i++) {
		let x = t[255 - i];
		x |= x << 8;
		box[t[i]] = (x ^ x >> 4 ^ x >> 5 ^ x >> 6 ^ x >> 7 ^ 99) & 255;
	}
	clean(t);
	return box;
})();
const invSbox = /* @__PURE__ */ sbox.map((_, j) => sbox.indexOf(j));
const rotr32_8 = (n) => n << 24 | n >>> 8;
const rotl32_8 = (n) => n << 8 | n >>> 24;
function genTtable(sbox, fn) {
	if (sbox.length !== 256) throw new Error("Wrong sbox length");
	const T0 = (/* @__PURE__ */ new Uint32Array(256)).map((_, j) => fn(sbox[j]));
	const T1 = T0.map(rotl32_8);
	const T2 = T1.map(rotl32_8);
	const T3 = T2.map(rotl32_8);
	const T01 = /* @__PURE__ */ new Uint32Array(65536);
	const T23 = /* @__PURE__ */ new Uint32Array(65536);
	const sbox2 = /* @__PURE__ */ new Uint16Array(65536);
	for (let i = 0; i < 256; i++) for (let j = 0; j < 256; j++) {
		const idx = i * 256 + j;
		T01[idx] = T0[i] ^ T1[j];
		T23[idx] = T2[i] ^ T3[j];
		sbox2[idx] = sbox[i] << 8 | sbox[j];
	}
	return {
		sbox,
		sbox2,
		T0,
		T1,
		T2,
		T3,
		T01,
		T23
	};
}
const tableEncoding = /* @__PURE__ */ genTtable(sbox, (s) => mul(s, 3) << 24 | s << 16 | s << 8 | mul(s, 2));
const tableDecoding = /* @__PURE__ */ genTtable(invSbox, (s) => mul(s, 11) << 24 | mul(s, 13) << 16 | mul(s, 9) << 8 | mul(s, 14));
const xPowers = /* @__PURE__ */ (() => {
	const p = /* @__PURE__ */ new Uint8Array(16);
	for (let i = 0, x = 1; i < 16; i++, x = mul2(x)) p[i] = x;
	return p;
})();
/** Key expansion used in CTR. */
function expandKeyLE(key) {
	abytes(key);
	const len = key.length;
	if (![
		16,
		24,
		32
	].includes(len)) throw new Error("aes: invalid key size, should be 16, 24 or 32, got " + len);
	const { sbox2 } = tableEncoding;
	const toClean = [];
	if (!isAligned32(key)) toClean.push(key = copyBytes(key));
	const k32 = u32(key);
	const Nk = k32.length;
	const subByte = (n) => applySbox(sbox2, n, n, n, n);
	const xk = new Uint32Array(len + 28);
	xk.set(k32);
	for (let i = Nk; i < xk.length; i++) {
		let t = xk[i - 1];
		if (i % Nk === 0) t = subByte(rotr32_8(t)) ^ xPowers[i / Nk - 1];
		else if (Nk > 6 && i % Nk === 4) t = subByte(t);
		xk[i] = xk[i - Nk] ^ t;
	}
	clean(...toClean);
	return xk;
}
function expandKeyDecLE(key) {
	const encKey = expandKeyLE(key);
	const xk = encKey.slice();
	const Nk = encKey.length;
	const { sbox2 } = tableEncoding;
	const { T0, T1, T2, T3 } = tableDecoding;
	for (let i = 0; i < Nk; i += 4) for (let j = 0; j < 4; j++) xk[i + j] = encKey[Nk - i - 4 + j];
	clean(encKey);
	for (let i = 4; i < Nk - 4; i++) {
		const x = xk[i];
		const w = applySbox(sbox2, x, x, x, x);
		xk[i] = T0[w & 255] ^ T1[w >>> 8 & 255] ^ T2[w >>> 16 & 255] ^ T3[w >>> 24];
	}
	return xk;
}
function apply0123(T01, T23, s0, s1, s2, s3) {
	return T01[s0 << 8 & 65280 | s1 >>> 8 & 255] ^ T23[s2 >>> 8 & 65280 | s3 >>> 24 & 255];
}
function applySbox(sbox2, s0, s1, s2, s3) {
	return sbox2[s0 & 255 | s1 & 65280] | sbox2[s2 >>> 16 & 255 | s3 >>> 16 & 65280] << 16;
}
function encrypt(xk, s0, s1, s2, s3) {
	const { sbox2, T01, T23 } = tableEncoding;
	let k = 0;
	s0 ^= xk[k++], s1 ^= xk[k++], s2 ^= xk[k++], s3 ^= xk[k++];
	const rounds = xk.length / 4 - 2;
	for (let i = 0; i < rounds; i++) {
		const t0 = xk[k++] ^ apply0123(T01, T23, s0, s1, s2, s3);
		const t1 = xk[k++] ^ apply0123(T01, T23, s1, s2, s3, s0);
		const t2 = xk[k++] ^ apply0123(T01, T23, s2, s3, s0, s1);
		const t3 = xk[k++] ^ apply0123(T01, T23, s3, s0, s1, s2);
		s0 = t0, s1 = t1, s2 = t2, s3 = t3;
	}
	return {
		s0: xk[k++] ^ applySbox(sbox2, s0, s1, s2, s3),
		s1: xk[k++] ^ applySbox(sbox2, s1, s2, s3, s0),
		s2: xk[k++] ^ applySbox(sbox2, s2, s3, s0, s1),
		s3: xk[k++] ^ applySbox(sbox2, s3, s0, s1, s2)
	};
}
function decrypt(xk, s0, s1, s2, s3) {
	const { sbox2, T01, T23 } = tableDecoding;
	let k = 0;
	s0 ^= xk[k++], s1 ^= xk[k++], s2 ^= xk[k++], s3 ^= xk[k++];
	const rounds = xk.length / 4 - 2;
	for (let i = 0; i < rounds; i++) {
		const t0 = xk[k++] ^ apply0123(T01, T23, s0, s3, s2, s1);
		const t1 = xk[k++] ^ apply0123(T01, T23, s1, s0, s3, s2);
		const t2 = xk[k++] ^ apply0123(T01, T23, s2, s1, s0, s3);
		const t3 = xk[k++] ^ apply0123(T01, T23, s3, s2, s1, s0);
		s0 = t0, s1 = t1, s2 = t2, s3 = t3;
	}
	return {
		s0: xk[k++] ^ applySbox(sbox2, s0, s3, s2, s1),
		s1: xk[k++] ^ applySbox(sbox2, s1, s0, s3, s2),
		s2: xk[k++] ^ applySbox(sbox2, s2, s1, s0, s3),
		s3: xk[k++] ^ applySbox(sbox2, s3, s2, s1, s0)
	};
}
function validateBlockDecrypt(data) {
	abytes(data);
	if (data.length % BLOCK_SIZE !== 0) throw new Error("aes-(cbc/ecb).decrypt ciphertext should consist of blocks with size 16");
}
function validateBlockEncrypt(plaintext, pcks5, dst) {
	abytes(plaintext);
	let outLen = plaintext.length;
	const remaining = outLen % BLOCK_SIZE;
	if (!pcks5 && remaining !== 0) throw new Error("aec/(cbc-ecb): unpadded plaintext with disabled padding");
	if (!isAligned32(plaintext)) plaintext = copyBytes(plaintext);
	const b = u32(plaintext);
	if (pcks5) {
		let left = BLOCK_SIZE - remaining;
		if (!left) left = BLOCK_SIZE;
		outLen = outLen + left;
	}
	dst = getOutput(outLen, dst);
	complexOverlapBytes(plaintext, dst);
	return {
		b,
		o: u32(dst),
		out: dst
	};
}
function validatePCKS(data, pcks5) {
	if (!pcks5) return data;
	const len = data.length;
	if (!len) throw new Error("aes/pcks5: empty ciphertext not allowed");
	const lastByte = data[len - 1];
	if (lastByte <= 0 || lastByte > 16) throw new Error("aes/pcks5: wrong padding");
	const out = data.subarray(0, -lastByte);
	for (let i = 0; i < lastByte; i++) if (data[len - i - 1] !== lastByte) throw new Error("aes/pcks5: wrong padding");
	return out;
}
function padPCKS(left) {
	const tmp = /* @__PURE__ */ new Uint8Array(16);
	const tmp32 = u32(tmp);
	tmp.set(left);
	const paddingByte = BLOCK_SIZE - left.length;
	for (let i = BLOCK_SIZE - paddingByte; i < BLOCK_SIZE; i++) tmp[i] = paddingByte;
	return tmp32;
}
/**
* ECB: Electronic CodeBook. Simple deterministic replacement.
* Dangerous: always map x to y. See [AES Penguin](https://words.filippo.io/the-ecb-penguin/).
*/
const ecb = /* @__PURE__ */ wrapCipher({ blockSize: 16 }, function aesecb(key, opts = {}) {
	const pcks5 = !opts.disablePadding;
	return {
		encrypt(plaintext, dst) {
			const { b, o, out: _out } = validateBlockEncrypt(plaintext, pcks5, dst);
			const xk = expandKeyLE(key);
			let i = 0;
			for (; i + 4 <= b.length;) {
				const { s0, s1, s2, s3 } = encrypt(xk, b[i + 0], b[i + 1], b[i + 2], b[i + 3]);
				o[i++] = s0, o[i++] = s1, o[i++] = s2, o[i++] = s3;
			}
			if (pcks5) {
				const tmp32 = padPCKS(plaintext.subarray(i * 4));
				const { s0, s1, s2, s3 } = encrypt(xk, tmp32[0], tmp32[1], tmp32[2], tmp32[3]);
				o[i++] = s0, o[i++] = s1, o[i++] = s2, o[i++] = s3;
			}
			clean(xk);
			return _out;
		},
		decrypt(ciphertext, dst) {
			validateBlockDecrypt(ciphertext);
			const xk = expandKeyDecLE(key);
			dst = getOutput(ciphertext.length, dst);
			const toClean = [xk];
			if (!isAligned32(ciphertext)) toClean.push(ciphertext = copyBytes(ciphertext));
			complexOverlapBytes(ciphertext, dst);
			const b = u32(ciphertext);
			const o = u32(dst);
			for (let i = 0; i + 4 <= b.length;) {
				const { s0, s1, s2, s3 } = decrypt(xk, b[i + 0], b[i + 1], b[i + 2], b[i + 3]);
				o[i++] = s0, o[i++] = s1, o[i++] = s2, o[i++] = s3;
			}
			clean(...toClean);
			return validatePCKS(dst, pcks5);
		}
	};
});
/**
* CBC: Cipher-Block-Chaining. Key is previous round’s block.
* Fragile: needs proper padding. Unauthenticated: needs MAC.
*/
const cbc = /* @__PURE__ */ wrapCipher({
	blockSize: 16,
	nonceLength: 16
}, function aescbc(key, iv, opts = {}) {
	const pcks5 = !opts.disablePadding;
	return {
		encrypt(plaintext, dst) {
			const xk = expandKeyLE(key);
			const { b, o, out: _out } = validateBlockEncrypt(plaintext, pcks5, dst);
			let _iv = iv;
			const toClean = [xk];
			if (!isAligned32(_iv)) toClean.push(_iv = copyBytes(_iv));
			const n32 = u32(_iv);
			let s0 = n32[0], s1 = n32[1], s2 = n32[2], s3 = n32[3];
			let i = 0;
			for (; i + 4 <= b.length;) {
				s0 ^= b[i + 0], s1 ^= b[i + 1], s2 ^= b[i + 2], s3 ^= b[i + 3];
				({s0, s1, s2, s3} = encrypt(xk, s0, s1, s2, s3));
				o[i++] = s0, o[i++] = s1, o[i++] = s2, o[i++] = s3;
			}
			if (pcks5) {
				const tmp32 = padPCKS(plaintext.subarray(i * 4));
				s0 ^= tmp32[0], s1 ^= tmp32[1], s2 ^= tmp32[2], s3 ^= tmp32[3];
				({s0, s1, s2, s3} = encrypt(xk, s0, s1, s2, s3));
				o[i++] = s0, o[i++] = s1, o[i++] = s2, o[i++] = s3;
			}
			clean(...toClean);
			return _out;
		},
		decrypt(ciphertext, dst) {
			validateBlockDecrypt(ciphertext);
			const xk = expandKeyDecLE(key);
			let _iv = iv;
			const toClean = [xk];
			if (!isAligned32(_iv)) toClean.push(_iv = copyBytes(_iv));
			const n32 = u32(_iv);
			dst = getOutput(ciphertext.length, dst);
			if (!isAligned32(ciphertext)) toClean.push(ciphertext = copyBytes(ciphertext));
			complexOverlapBytes(ciphertext, dst);
			const b = u32(ciphertext);
			const o = u32(dst);
			let s0 = n32[0], s1 = n32[1], s2 = n32[2], s3 = n32[3];
			for (let i = 0; i + 4 <= b.length;) {
				const ps0 = s0, ps1 = s1, ps2 = s2, ps3 = s3;
				s0 = b[i + 0], s1 = b[i + 1], s2 = b[i + 2], s3 = b[i + 3];
				const { s0: o0, s1: o1, s2: o2, s3: o3 } = decrypt(xk, s0, s1, s2, s3);
				o[i++] = o0 ^ ps0, o[i++] = o1 ^ ps1, o[i++] = o2 ^ ps2, o[i++] = o3 ^ ps3;
			}
			clean(...toClean);
			return validatePCKS(dst, pcks5);
		}
	};
});
export { cbc, ecb };
