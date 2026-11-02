import { createRequire as __wkfCreateRequire } from "node:module";
if (typeof require === "undefined") globalThis.require = __wkfCreateRequire(import.meta.url);
import { __commonJSMin } from "../_runtime.mjs";
// node_modules/base64-js/index.js
var require_base64_js = /* @__PURE__ */ __commonJSMin(((exports) => {
	exports.toByteArray = toByteArray;
	var lookup = [];
	var revLookup = [];
	var Arr = typeof Uint8Array !== "undefined" ? Uint8Array : Array;
	var code = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	for (var i = 0, len = code.length; i < len; ++i) {
		lookup[i] = code[i];
		revLookup[code.charCodeAt(i)] = i;
	}
	revLookup["-".charCodeAt(0)] = 62;
	revLookup["_".charCodeAt(0)] = 63;
	function getLens(b64) {
		var len = b64.length;
		if (len % 4 > 0) throw new Error("Invalid string. Length must be a multiple of 4");
		var validLen = b64.indexOf("=");
		if (validLen === -1) validLen = len;
		var placeHoldersLen = validLen === len ? 0 : 4 - validLen % 4;
		return [validLen, placeHoldersLen];
	}
	function _byteLength(b64, validLen, placeHoldersLen) {
		return (validLen + placeHoldersLen) * 3 / 4 - placeHoldersLen;
	}
	function toByteArray(b64) {
		var tmp;
		var lens = getLens(b64);
		var validLen = lens[0];
		var placeHoldersLen = lens[1];
		var arr = new Arr(_byteLength(b64, validLen, placeHoldersLen));
		var curByte = 0;
		var len = placeHoldersLen > 0 ? validLen - 4 : validLen;
		var i = 0;
		for (; i < len; i += 4) {
			tmp = revLookup[b64.charCodeAt(i)] << 18 | revLookup[b64.charCodeAt(i + 1)] << 12 | revLookup[b64.charCodeAt(i + 2)] << 6 | revLookup[b64.charCodeAt(i + 3)];
			arr[curByte++] = tmp >> 16 & 255;
			arr[curByte++] = tmp >> 8 & 255;
			arr[curByte++] = tmp & 255;
		}
		if (placeHoldersLen === 2) {
			tmp = revLookup[b64.charCodeAt(i)] << 2 | revLookup[b64.charCodeAt(i + 1)] >> 4;
			arr[curByte++] = tmp & 255;
		}
		if (placeHoldersLen === 1) {
			tmp = revLookup[b64.charCodeAt(i)] << 10 | revLookup[b64.charCodeAt(i + 1)] << 4 | revLookup[b64.charCodeAt(i + 2)] >> 2;
			arr[curByte++] = tmp >> 8 & 255;
			arr[curByte++] = tmp & 255;
		}
		return arr;
	}
}));
// node_modules/linebreak/node_modules/base64-js/lib/b64.js
var require_b64 = /* @__PURE__ */ __commonJSMin(((exports, module, this$1) => {
	var lookup = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	(function(exports) {
		"use strict";
		var Arr = typeof Uint8Array !== "undefined" ? Uint8Array : Array;
		var PLUS = "+".charCodeAt(0);
		var SLASH = "/".charCodeAt(0);
		var NUMBER = "0".charCodeAt(0);
		var LOWER = "a".charCodeAt(0);
		var UPPER = "A".charCodeAt(0);
		var PLUS_URL_SAFE = "-".charCodeAt(0);
		var SLASH_URL_SAFE = "_".charCodeAt(0);
		function decode(elt) {
			var code = elt.charCodeAt(0);
			if (code === PLUS || code === PLUS_URL_SAFE) return 62;
			if (code === SLASH || code === SLASH_URL_SAFE) return 63;
			if (code < NUMBER) return -1;
			if (code < NUMBER + 10) return code - NUMBER + 26 + 26;
			if (code < UPPER + 26) return code - UPPER;
			if (code < LOWER + 26) return code - LOWER + 26;
		}
		function b64ToByteArray(b64) {
			var i, j, l, tmp, placeHolders, arr;
			if (b64.length % 4 > 0) throw new Error("Invalid string. Length must be a multiple of 4");
			var len = b64.length;
			placeHolders = "=" === b64.charAt(len - 2) ? 2 : "=" === b64.charAt(len - 1) ? 1 : 0;
			arr = new Arr(b64.length * 3 / 4 - placeHolders);
			l = placeHolders > 0 ? b64.length - 4 : b64.length;
			var L = 0;
			function push(v) {
				arr[L++] = v;
			}
			for (i = 0, j = 0; i < l; i += 4, j += 3) {
				tmp = decode(b64.charAt(i)) << 18 | decode(b64.charAt(i + 1)) << 12 | decode(b64.charAt(i + 2)) << 6 | decode(b64.charAt(i + 3));
				push((tmp & 16711680) >> 16);
				push((tmp & 65280) >> 8);
				push(tmp & 255);
			}
			if (placeHolders === 2) {
				tmp = decode(b64.charAt(i)) << 2 | decode(b64.charAt(i + 1)) >> 4;
				push(tmp & 255);
			} else if (placeHolders === 1) {
				tmp = decode(b64.charAt(i)) << 10 | decode(b64.charAt(i + 1)) << 4 | decode(b64.charAt(i + 2)) >> 2;
				push(tmp >> 8 & 255);
				push(tmp & 255);
			}
			return arr;
		}
		function uint8ToBase64(uint8) {
			var i, extraBytes = uint8.length % 3, output = "", temp, length;
			function encode(num) {
				return lookup.charAt(num);
			}
			function tripletToBase64(num) {
				return encode(num >> 18 & 63) + encode(num >> 12 & 63) + encode(num >> 6 & 63) + encode(num & 63);
			}
			for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
				temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + uint8[i + 2];
				output += tripletToBase64(temp);
			}
			switch (extraBytes) {
				case 1:
					temp = uint8[uint8.length - 1];
					output += encode(temp >> 2);
					output += encode(temp << 4 & 63);
					output += "==";
					break;
				case 2:
					temp = (uint8[uint8.length - 2] << 8) + uint8[uint8.length - 1];
					output += encode(temp >> 10);
					output += encode(temp >> 4 & 63);
					output += encode(temp << 2 & 63);
					output += "=";
			}
			return output;
		}
		exports.toByteArray = b64ToByteArray;
		exports.fromByteArray = uint8ToBase64;
	})(typeof exports === "undefined" ? this$1.base64js = {} : exports);
}));
export { require_b64, require_base64_js };
