import { createRequire as __wkfCreateRequire } from "node:module";
if (typeof require === "undefined") globalThis.require = __wkfCreateRequire(import.meta.url);
import { IncomingMessage, ServerResponse } from "node:http";
import { Duplex, PassThrough, Readable, addAbortSignal } from "node:stream";
import { pipeline } from "node:stream/promises";
import "node:https";
// node_modules/nitro/node_modules/srvx/dist/_chunks/_url.mjs
function getNativeClass(key, current) {
	let C = globalThis[key] || current;
	let P = Object.getPrototypeOf(C);
	while (typeof P === "function" && P.prototype) {
		C = P;
		P = Object.getPrototypeOf(C);
	}
	return globalThis[key] = C;
}
function lazyInherit(target, source, sourceKey) {
	for (const key of [...Object.getOwnPropertyNames(source), ...Object.getOwnPropertySymbols(source)]) {
		if (key === "constructor") continue;
		const targetDesc = Object.getOwnPropertyDescriptor(target, key);
		const desc = Object.getOwnPropertyDescriptor(source, key);
		let modified = false;
		if (desc.get) {
			modified = true;
			desc.get = targetDesc?.get || function() {
				return this[sourceKey][key];
			};
		}
		if (desc.set) {
			modified = true;
			desc.set = targetDesc?.set || function(value) {
				this[sourceKey][key] = value;
			};
		}
		if (!targetDesc?.value && typeof desc.value === "function") {
			modified = true;
			desc.value = function(...args) {
				return this[sourceKey][key](...args);
			};
		}
		if (modified) Object.defineProperty(target, key, desc);
	}
}
const _needsNormRE = /(?:(?:^|\/)(?:\.|\.\.|%2e|%2e\.|\.%2e|%2e%2e)(?:\/|$))|[\\^#"<>{}`\x00-\x20\x7f-\uffff]/i;
const _searchNeedsNormRE = /[#"'<>\x00-\x20\x7f-\uffff]/;
const FastURL = /* @__PURE__ */ (() => {
	const NativeURL = globalThis.URL;
	const NativeSearchParams = globalThis.URLSearchParams;
	const FastURLSearchParams = class URLSearchParams {
		#owner;
		#params;
		constructor(owner) {
			this.#owner = owner;
		}
		static [Symbol.hasInstance](val) {
			return val instanceof NativeSearchParams;
		}
		_adopt(params) {
			this.#params = params;
		}
		get _params() {
			if (!this.#params) {
				const search = this.#owner.search;
				this.#params ??= new NativeSearchParams(search);
			}
			return this.#params;
		}
		#mutable() {
			this.#owner._url;
			return this.#params;
		}
		append(name, value) {
			this.#mutable().append(name, value);
		}
		set(name, value) {
			this.#mutable().set(name, value);
		}
		delete(name, value) {
			this.#mutable().delete(name, value);
		}
		sort() {
			this.#mutable().sort();
		}
	};
	lazyInherit(FastURLSearchParams.prototype, NativeSearchParams.prototype, "_params");
	Object.setPrototypeOf(FastURLSearchParams.prototype, NativeSearchParams.prototype);
	Object.setPrototypeOf(FastURLSearchParams, NativeSearchParams);
	const FastURL = class URL {
		#url;
		#href;
		#protocol;
		#host;
		#pathname;
		#search;
		#searchParams;
		#pos;
		constructor(url) {
			if (typeof url === "string") {
				const isOriginForm = url[0] === "/";
				if (isOriginForm && !_searchNeedsNormRE.test(url)) this.#href = `http://localhost${url}`;
				else this.#url = new NativeURL(isOriginForm ? `http://localhost${url}` : url);
			} else if (_needsNormRE.test(url.pathname) || url.search && _searchNeedsNormRE.test(url.search)) this.#url = new NativeURL(`${url.protocol || "http:"}//${url.host || "localhost"}${url.pathname}${url.search || ""}`);
			else {
				this.#protocol = url.protocol;
				this.#host = url.host;
				this.#pathname = url.pathname;
				this.#search = url.search;
			}
		}
		static [Symbol.hasInstance](val) {
			return val instanceof NativeURL;
		}
		get _url() {
			if (this.#url) return this.#url;
			this.#url = new NativeURL(this.href);
			this.#href = void 0;
			this.#protocol = void 0;
			this.#host = void 0;
			this.#pathname = void 0;
			this.#search = void 0;
			this.#pos = void 0;
			this.#searchParams?._adopt(this.#url.searchParams);
			return this.#url;
		}
		get href() {
			if (this.#url) return this.#url.href;
			if (!this.#href) this.#href = `${this.#protocol || "http:"}//${this.#host || "localhost"}${this.#pathname || "/"}${this.#search || ""}`;
			return this.#href;
		}
		#getPos() {
			if (!this.#pos) {
				const url = this.href;
				const protoIndex = url.indexOf("://");
				const pathnameIndex = protoIndex === -1 ? -1 : url.indexOf("/", protoIndex + 4);
				const qIndex = pathnameIndex === -1 ? -1 : url.indexOf("?", pathnameIndex);
				this.#pos = [
					protoIndex,
					pathnameIndex,
					qIndex
				];
			}
			return this.#pos;
		}
		get pathname() {
			if (this.#url) return this.#url.pathname;
			if (this.#pathname === void 0) {
				const [, pathnameIndex, queryIndex] = this.#getPos();
				if (pathnameIndex === -1) return this._url.pathname;
				this.#pathname = this.href.slice(pathnameIndex, queryIndex === -1 ? void 0 : queryIndex);
			}
			return this.#pathname;
		}
		get search() {
			if (this.#url) return this.#url.search;
			if (this.#search === void 0) {
				const [, pathnameIndex, queryIndex] = this.#getPos();
				if (pathnameIndex === -1) return this._url.search;
				const url = this.href;
				this.#search = queryIndex === -1 || queryIndex === url.length - 1 ? "" : url.slice(queryIndex);
			}
			return this.#search;
		}
		get searchParams() {
			if (this.#searchParams) return this.#searchParams;
			if (this.#url) return this.#url.searchParams;
			return this.#searchParams = new FastURLSearchParams(this);
		}
		get protocol() {
			if (this.#url) return this.#url.protocol;
			if (this.#protocol === void 0) {
				const [protocolIndex] = this.#getPos();
				if (protocolIndex === -1) return this._url.protocol;
				const url = this.href;
				this.#protocol = url.slice(0, protocolIndex + 1);
			}
			return this.#protocol;
		}
		get hash() {
			if (this.#url) return this.#url.hash;
			return "";
		}
		toString() {
			return this.href;
		}
		toJSON() {
			return this.href;
		}
	};
	lazyInherit(FastURL.prototype, NativeURL.prototype, "_url");
	Object.setPrototypeOf(FastURL.prototype, NativeURL.prototype);
	Object.setPrototypeOf(FastURL, NativeURL);
	return FastURL;
})();
// node_modules/nitro/node_modules/srvx/dist/body-limit.mjs
function limitBodyStream(stream, maxRequestBodySize, options) {
	const createError = options?.createError ?? createBodyTooLargeError;
	const reader = stream.getReader();
	let size = 0;
	return new ReadableStream({
		async pull(controller) {
			const { done, value } = await reader.read();
			if (done) {
				controller.close();
				return;
			}
			size += value.byteLength;
			if (size > maxRequestBodySize) {
				const error = createError(maxRequestBodySize);
				reader.cancel(error).catch(() => {});
				controller.error(error);
				return;
			}
			controller.enqueue(value);
		},
		cancel(reason) {
			return reader.cancel(reason);
		}
	});
}
var BodyTooLargeError = class extends Error {
	code = "ERR_BODY_TOO_LARGE";
	statusCode = 413;
	status = 413;
	statusText = "Content Too Large";
	get name() {
		return "HTTPError";
	}
	toJSON() {
		return {
			status: this.status,
			statusText: this.statusText,
			message: this.message
		};
	}
};
function createBodyTooLargeError(maxRequestBodySize) {
	return new BodyTooLargeError(`Request body exceeds the maximum allowed size of ${maxRequestBodySize} bytes.`);
}
// node_modules/nitro/node_modules/srvx/dist/_chunks/_trust-proxy.mjs
function isTrustedProxy(trustProxy, remoteAddress) {
	if (trustProxy === void 0 || trustProxy === false) return false;
	if (trustProxy === true) return true;
	if (trustProxy === "loopback") return isLoopbackAddress(remoteAddress);
	if (remoteAddress === void 0) return false;
	if (trustProxy.includes(remoteAddress)) return true;
	const mapped = ipv4FromMapped(remoteAddress);
	return mapped !== void 0 && trustProxy.includes(mapped);
}
function ipv4FromMapped(address) {
	return address.startsWith("::ffff:") && address.includes(".") ? address.slice(7) : void 0;
}
function isLoopbackAddress(address) {
	return !!address && (address === "::1" || address.startsWith("127.") || address.startsWith("::ffff:127."));
}
const HOST_RE = /^(\[(?:[A-Fa-f0-9:.]+)\]|(?:[A-Za-z0-9_-]+\.)*[A-Za-z0-9_-]+|(?:\d{1,3}\.){3}\d{1,3})(:\d{1,5})?$/;
function forwardedList(value) {
	if (!value) return [];
	const raw = Array.isArray(value) ? value.join(",") : value;
	const out = [];
	for (const part of raw.split(",")) {
		const entry = part.trim();
		if (entry) out.push(entry);
	}
	return out;
}
function resolveClientIP(trustProxy, peer, forwardedFor) {
	if (!isTrustedProxy(trustProxy, peer)) return peer;
	const list = forwardedList(forwardedFor);
	for (let i = list.length - 1; i >= 0; i--) if (!isTrustedProxy(trustProxy, list[i])) return list[i];
	return list.length > 0 ? list[0] : peer;
}
function trustedHops(trustProxy, peer, forwardedFor) {
	if (!isTrustedProxy(trustProxy, peer)) return 0;
	const list = forwardedList(forwardedFor);
	let hops = 1;
	for (let i = list.length - 1; i >= 0; i--) {
		if (!isTrustedProxy(trustProxy, list[i])) return hops;
		hops++;
	}
	return Number.POSITIVE_INFINITY;
}
function forwardedHopValue(value, hops) {
	if (hops <= 0) return;
	const list = forwardedList(value);
	if (list.length === 0) return;
	return list[Math.max(0, list.length - hops)];
}
// node_modules/nitro/node_modules/srvx/dist/adapters/node.mjs
function sendNodeResponse(nodeRes, webRes) {
	try {
		return _sendNodeResponse(nodeRes, webRes, false) || Promise.resolve();
	} catch (error) {
		return Promise.reject(error);
	}
}
function handleSendError(nodeRes, error, silent) {
	if (!silent) console.error("[srvx] Failed to send response:", error);
	failResponse(nodeRes);
}
function failResponse(nodeRes) {
	if (nodeRes.writableEnded) return;
	if (nodeRes.headersSent) nodeRes.destroy();
	else {
		nodeRes.statusCode = 500;
		if (nodeRes.req?.httpVersion !== "2.0") nodeRes.statusMessage = "";
		nodeRes.end();
	}
}
function _sendNodeResponse(nodeRes, webRes, detached) {
	if (!webRes) {
		nodeRes.statusCode = 500;
		return endNodeResponse(nodeRes, detached);
	}
	if (webRes._toNodeResponse) {
		const res = webRes._toNodeResponse();
		if (res.body) {
			if (res.body instanceof ReadableStream) {
				writeHead(nodeRes, res.status, res.statusText, res.headers);
				return streamBody(res.body, nodeRes);
			} else if (typeof res.body?.pipe === "function") return pipeBody(res.body, nodeRes, res.status, res.statusText, res.headers);
			writeHead(nodeRes, res.status, res.statusText, res.headers);
			nodeRes.write(res.body);
		} else writeHead(nodeRes, res.status, res.statusText, res.headers);
		return endNodeResponse(nodeRes, detached);
	}
	const rawHeaders = [];
	for (const [key, value] of webRes.headers) rawHeaders.push(key, value);
	writeHead(nodeRes, webRes.status, webRes.statusText, rawHeaders);
	return webRes.body ? streamBody(webRes.body, nodeRes) : endNodeResponse(nodeRes, detached);
}
function writeHead(nodeRes, status, statusText, rawHeaders) {
	if (!nodeRes.headersSent) {
		if (nodeRes.req?.httpVersion === "2.0") nodeRes.writeHead(status, rawHeaders);
		else nodeRes.writeHead(status, safeStatusText(statusText), rawHeaders);
	}
}
const INVALID_REASON_PHRASE_RE = /[^\t\u0020-\u007E\u0080-\u00FF]/g;
function safeStatusText(statusText) {
	return typeof statusText === "string" && statusText ? statusText.replace(INVALID_REASON_PHRASE_RE, "") : statusText;
}
function endNodeResponse(nodeRes, detached) {
	if (detached) {
		nodeRes.end();
		return;
	}
	return new Promise((resolve) => nodeRes.end(resolve));
}
function pipeBody(stream, nodeRes, status, statusText, headers) {
	if (nodeRes.destroyed) {
		stream.destroy?.();
		return;
	}
	if (nodeRes.req?.method === "HEAD") {
		if (typeof stream.destroy === "function") stream.destroy();
		else stream.abort?.();
		writeHead(nodeRes, status, statusText, headers);
		return endNodeResponse(nodeRes);
	}
	if (typeof stream.on !== "function" || typeof stream.destroy !== "function") {
		writeHead(nodeRes, status, statusText, headers);
		stream.pipe(nodeRes);
		return new Promise((resolve) => nodeRes.on("close", resolve));
	}
	if (stream.destroyed) {
		writeHead(nodeRes, 500, "Internal Server Error", []);
		return endNodeResponse(nodeRes);
	}
	return new Promise((resolve) => {
		function cleanup() {
			stream.off("error", onEarlyError);
			stream.off("readable", onReadable);
			nodeRes.off("close", onResClose);
		}
		function onEarlyError() {
			cleanup();
			stream.destroy();
			writeHead(nodeRes, 500, "Internal Server Error", []);
			endNodeResponse(nodeRes).then(resolve);
		}
		function onReadable() {
			cleanup();
			if (nodeRes.destroyed) {
				stream.destroy();
				return resolve();
			}
			writeHead(nodeRes, status, statusText, headers);
			pipeline(stream, nodeRes).catch(() => {}).then(() => resolve());
		}
		function onResClose() {
			cleanup();
			stream.destroy();
			resolve();
		}
		stream.once("error", onEarlyError);
		stream.once("readable", onReadable);
		nodeRes.once("close", onResClose);
	});
}
function streamBody(stream, nodeRes) {
	if (nodeRes.destroyed) {
		stream.cancel().catch(() => {});
		return;
	}
	if (nodeRes.req?.method === "HEAD") {
		stream.cancel().catch(() => {});
		return endNodeResponse(nodeRes);
	}
	const reader = stream.getReader();
	function streamCancel(error) {
		reader.cancel(error).catch(() => {});
		if (error) nodeRes.destroy(error);
	}
	function streamHandle({ done, value }) {
		try {
			if (done) nodeRes.end();
			else if (nodeRes.write(value)) reader.read().then(streamHandle, streamCancel);
			else nodeRes.once("drain", () => reader.read().then(streamHandle, streamCancel));
		} catch (error) {
			streamCancel(error instanceof Error ? error : void 0);
		}
	}
	nodeRes.on("close", streamCancel);
	nodeRes.on("error", streamCancel);
	reader.read().then(streamHandle, streamCancel);
	return reader.closed.catch(streamCancel).finally(() => {
		nodeRes.off("close", streamCancel);
		nodeRes.off("error", streamCancel);
	});
}
var NodeRequestURL = class extends FastURL {
	constructor({ req, hops = 0 }) {
		const path = req.url || "/";
		const trusted = hops > 0;
		const forwardedHost = forwardedHopValue(req.headers["x-forwarded-host"], hops);
		let host = (forwardedHost && HOST_RE.test(forwardedHost) ? forwardedHost : void 0) || req.headers.host || req.headers[":authority"];
		if (host && !HOST_RE.test(host)) host = "_invalid_";
		else if (!host) {
			if (req.socket) host = `${req.socket.localFamily === "IPv6" ? "[" + req.socket.localAddress + "]" : req.socket.localAddress}:${req.socket?.localPort || "80"}`;
			else host = "localhost";
		}
		const forwardedProto = forwardedHopValue(req.headers["x-forwarded-proto"], hops);
		const protocol = req.socket?.encrypted || forwardedProto === "https" || trusted && req.headers[":scheme"] === "https" ? "https:" : "http:";
		if (path[0] === "/") {
			const qIndex = path.indexOf("?");
			super({
				protocol,
				host,
				pathname: qIndex === -1 ? path : path.slice(0, qIndex) || "/",
				search: qIndex === -1 ? "" : path.slice(qIndex) || ""
			});
		} else if (path === "*") super({
			protocol,
			host,
			pathname: "/*",
			search: ""
		});
		else {
			const target = URL.canParse(path) ? new URL(path) : void 0;
			if (target) {
				const targetHost = target.host;
				const targetPath = target.pathname;
				super({
					protocol,
					host: targetHost ? HOST_RE.test(targetHost) ? targetHost : "_invalid_" : host,
					pathname: targetPath ? targetPath[0] === "/" ? targetPath : `/${targetPath}` : "/",
					search: target.search
				});
			} else super({
				protocol,
				host,
				pathname: "/",
				search: ""
			});
		}
	}
};
const _nonJoinedHeaders = /* @__PURE__ */ new Set([
	"age",
	"authorization",
	"content-length",
	"content-type",
	"etag",
	"expires",
	"from",
	"host",
	"if-modified-since",
	"if-unmodified-since",
	"last-modified",
	"location",
	"max-forwards",
	"proxy-authorization",
	"referer",
	"retry-after",
	"server",
	"user-agent"
]);
const _validHeaderNameRE = /^[!#$%&'*+\-.^_`|~\dA-Za-z]+$/;
function _isRepeated(rawHeaders, lowerName) {
	let seen = false;
	for (let i = 0; i < rawHeaders.length; i += 2) {
		const key = rawHeaders[i];
		if (key.length === lowerName.length && key.toLowerCase() === lowerName) {
			if (seen) return true;
			seen = true;
		}
	}
	return false;
}
const NodeRequestHeaders = /* @__PURE__ */ (() => {
	const NativeHeaders = globalThis.Headers;
	class Headers {
		#req;
		#headers;
		constructor(req) {
			this.#req = req;
		}
		static [Symbol.hasInstance](val) {
			return val instanceof NativeHeaders;
		}
		_adopt(headers) {
			this.#headers = headers;
		}
		get _headers() {
			if (!this.#headers) {
				const headers = new NativeHeaders();
				const rawHeaders = this.#req.rawHeaders;
				const len = rawHeaders.length;
				for (let i = 0; i < len; i += 2) {
					const key = rawHeaders[i];
					if (key.charCodeAt(0) === 58) continue;
					const value = rawHeaders[i + 1];
					headers.append(key, value);
				}
				this.#headers = headers;
			}
			return this.#headers;
		}
		get(name) {
			if (this.#headers) return this.#headers.get(name);
			const lower = name.toLowerCase();
			if (lower.charCodeAt(0) === 58) return this._headers.get(name);
			const value = this.#req.headers[lower];
			if (typeof value === "string") return _nonJoinedHeaders.has(lower) && _isRepeated(this.#req.rawHeaders, lower) ? this._headers.get(name) : value;
			if (Array.isArray(value)) return value.join(", ");
			return lower !== "__proto__" && _validHeaderNameRE.test(name) ? null : this._headers.get(name);
		}
		has(name) {
			if (this.#headers) return this.#headers.has(name);
			const lower = name.toLowerCase();
			if (lower.charCodeAt(0) === 58) return this._headers.has(name);
			if (Object.hasOwn(this.#req.headers, lower)) return true;
			return lower !== "__proto__" && _validHeaderNameRE.test(name) ? false : this._headers.has(name);
		}
		getSetCookie() {
			if (this.#headers) return this.#headers.getSetCookie();
			const value = this.#req.headers["set-cookie"];
			return Array.isArray(value) ? value.slice() : value ? [value] : [];
		}
		entries() {
			return this._headers.entries();
		}
		[Symbol.iterator]() {
			return this.entries();
		}
	}
	lazyInherit(Headers.prototype, NativeHeaders.prototype, "_headers");
	Object.setPrototypeOf(Headers, NativeHeaders);
	Object.setPrototypeOf(Headers.prototype, NativeHeaders.prototype);
	return Headers;
})();
const kNativeRequest = /* @__PURE__ */ Symbol.for("srvx.nativeRequest");
function bodyUnusable() {
	return /* @__PURE__ */ new TypeError("Body is unusable: Body has already been read");
}
function abortError() {
	return new DOMException("The request was aborted.", "AbortError");
}
function erroredStream(error) {
	return new ReadableStream({ start(controller) {
		controller.error(error);
	} });
}
function isClientGone(req) {
	return req.aborted || !!req.errored || req.destroyed && !req.complete;
}
function isBodySourceFinished(req) {
	return isClientGone(req) || req.destroyed || req.readableEnded;
}
const NodeRequest = /* @__PURE__ */ (() => {
	const NativeRequest = getNativeClass(kNativeRequest, globalThis.Request);
	class Request {
		runtime;
		waitUntil;
		#req;
		#url;
		#bodyStream;
		#bodyUsed = false;
		#request;
		#headers;
		#abortController;
		#maxRequestBodySize;
		#trustProxy;
		#ip;
		#ipResolved = false;
		#remoteAddress;
		#remoteResolved = false;
		#hops;
		constructor(ctx) {
			this.#req = ctx.req;
			this.#maxRequestBodySize = ctx.maxRequestBodySize;
			this.#trustProxy = ctx.trustProxy;
			this.runtime = {
				name: "node",
				node: ctx
			};
		}
		static [Symbol.hasInstance](val) {
			return val instanceof NativeRequest;
		}
		#remoteAddr() {
			if (!this.#remoteResolved) {
				this.#remoteResolved = true;
				this.#remoteAddress = this.#req.socket?.remoteAddress;
			}
			return this.#remoteAddress;
		}
		#resolveHops() {
			if (this.#hops === void 0) this.#hops = trustedHops(this.#trustProxy, this.#remoteAddr(), this.#req.headers["x-forwarded-for"]);
			return this.#hops;
		}
		get ip() {
			if (this.#ipResolved) return this.#ip;
			this.#ipResolved = true;
			return this.#ip = resolveClientIP(this.#trustProxy, this.#remoteAddr(), this.#req.headers["x-forwarded-for"]);
		}
		get method() {
			if (this.#request) return this.#request.method;
			return this.#req.method || "GET";
		}
		get _url() {
			return this.#url ||= new NodeRequestURL({
				req: this.#req,
				hops: this.#resolveHops()
			});
		}
		set _url(url) {
			this.#url = url;
		}
		get url() {
			if (this.#request) return this.#request.url;
			return this._url.href;
		}
		get headers() {
			return this.#headers ||= new NodeRequestHeaders(this.#req);
		}
		get _abortController() {
			if (!this.#abortController) {
				this.#abortController = new AbortController();
				const { req, res } = this.runtime.node;
				const abortController = this.#abortController;
				const abort = (err) => abortController.abort?.(err);
				if (res) {
					const onClose = () => {
						const reqError = req.errored;
						if (reqError) abort(reqError);
						else if (!res.writableEnded) abort();
					};
					res.once("close", onClose);
					if (res.destroyed || isClientGone(req)) onClose();
				} else {
					const onClose = () => {
						if (!req.complete || req.aborted) abort();
					};
					req.once("close", onClose);
					if (isClientGone(req)) onClose();
				}
			}
			return this.#abortController;
		}
		get signal() {
			return this.#request ? this.#request.signal : this._abortController.signal;
		}
		#hasBody() {
			const method = this.method;
			return method !== "GET" && method !== "HEAD";
		}
		get body() {
			if (this.#request) return this.#request.body;
			if (this.#bodyStream === void 0) {
				let stream = null;
				if (this.#hasBody() && !this.#bodyUsed) {
					if ("rawBody" in this.#req && Buffer.isBuffer(this.#req.rawBody)) stream = Readable.toWeb(Readable.from([this.#req.rawBody]));
					else if (isBodySourceFinished(this.#req)) stream = erroredStream(this.#bodyError());
					else stream = Readable.toWeb(this.#req);
				}
				if (stream && this.#maxRequestBodySize !== void 0) stream = limitBodyStream(stream, this.#maxRequestBodySize);
				this.#bodyStream = stream;
			}
			return this.#bodyStream;
		}
		get bodyUsed() {
			if (this.#isBodyUsed()) return true;
			return this.#request ? this.#request.bodyUsed : false;
		}
		#isBodyUsed() {
			if (!this.#bodyUsed && this.#bodyStream && Readable.isDisturbed(this.#bodyStream)) this.#bodyUsed = true;
			return this.#bodyUsed;
		}
		#bodyError() {
			const signal = this._abortController.signal;
			if (signal.aborted) return signal.reason;
			return this.#req.errored || (isClientGone(this.#req) ? abortError() : bodyUnusable());
		}
		#readBuffered() {
			if ("rawBody" in this.#req && Buffer.isBuffer(this.#req.rawBody)) return readBody(this.#req, this.#maxRequestBodySize);
			if (isBodySourceFinished(this.#req)) return Promise.reject(this.#bodyError());
			return readBody(this.#req, this.#maxRequestBodySize);
		}
		text() {
			if (this.#isBodyUsed()) return Promise.reject(bodyUnusable());
			if (this.#request) return this.#request.text();
			if (!this.#hasBody()) return Promise.resolve("");
			this.#bodyUsed = true;
			if (this.#bodyStream !== void 0) try {
				return new Response(this.#bodyStream).text();
			} catch (error) {
				return Promise.reject(error);
			}
			return this.#readBuffered().then((buf) => buf.toString());
		}
		json() {
			if (this.#isBodyUsed()) return Promise.reject(bodyUnusable());
			if (this.#request) return this.#request.json();
			if (!this.#hasBody()) return Promise.resolve().then(() => JSON.parse(""));
			this.#bodyUsed = true;
			if (this.#bodyStream !== void 0) try {
				return new Response(this.#bodyStream).json();
			} catch (error) {
				return Promise.reject(error);
			}
			return this.#readBuffered().then((buf) => JSON.parse(buf.toString()));
		}
		arrayBuffer() {
			return this.#consumeNative("arrayBuffer");
		}
		bytes() {
			return this.#consumeNative("bytes");
		}
		blob() {
			return this.#consumeNative("blob");
		}
		formData() {
			return this.#consumeNative("formData");
		}
		#consumeNative(method) {
			if (this.#isBodyUsed()) return Promise.reject(bodyUnusable());
			try {
				return this._request[method]();
			} catch (error) {
				return Promise.reject(error);
			}
		}
		get _request() {
			if (!this.#request) {
				const body = this.#isBodyUsed() ? null : this.body;
				this.#request = new NativeRequest(this.url, {
					method: this.method,
					headers: this.headers,
					signal: this._abortController.signal,
					body,
					duplex: body ? "half" : void 0
				});
				this.#headers._adopt(this.#request.headers);
				this.#bodyStream = void 0;
			}
			return this.#request;
		}
	}
	lazyInherit(Request.prototype, NativeRequest.prototype, "_request");
	Object.setPrototypeOf(Request.prototype, NativeRequest.prototype);
	return Request;
})();
function readBody(req, maxRequestBodySize) {
	if ("rawBody" in req && Buffer.isBuffer(req.rawBody)) {
		if (maxRequestBodySize !== void 0 && req.rawBody.length > maxRequestBodySize) return Promise.reject(createBodyTooLargeError(maxRequestBodySize));
		return Promise.resolve(req.rawBody);
	}
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		const cleanup = () => {
			req.off("data", onData);
			req.off("end", onEnd);
			req.off("error", onError);
			req.off("close", onClose);
		};
		const onData = (chunk) => {
			if (maxRequestBodySize !== void 0) {
				size += chunk.length;
				if (size > maxRequestBodySize) {
					cleanup();
					req.pause?.();
					reject(createBodyTooLargeError(maxRequestBodySize));
					return;
				}
			}
			chunks.push(chunk);
		};
		const onError = (err) => {
			cleanup();
			reject(err);
		};
		const onEnd = () => {
			cleanup();
			if (isClientGone(req)) {
				reject(req.errored || abortError());
				return;
			}
			resolve(chunks.length === 1 ? chunks[0] : Buffer.concat(chunks));
		};
		const onClose = () => {
			cleanup();
			reject(req.errored || abortError());
		};
		req.on("data", onData).once("end", onEnd).once("error", onError).once("close", onClose);
	});
}
const kNativeResponse = /* @__PURE__ */ Symbol.for("srvx.nativeResponse");
const NodeResponse = /* @__PURE__ */ (() => {
	const NativeResponse = getNativeClass(kNativeResponse, globalThis.Response);
	class NodeResponse {
		#body;
		#init;
		#headers;
		#response;
		constructor(body, init) {
			this.#body = body;
			this.#init = init;
		}
		static [Symbol.hasInstance](val) {
			if (this === NodeResponse) return val instanceof NativeResponse;
			return Object.prototype.isPrototypeOf.call(this.prototype, val);
		}
		static json(data, init) {
			const body = JSON.stringify(data);
			if (body === void 0) throw new TypeError("Value is not JSON serializable");
			let headers = init?.headers;
			if (!headers) headers = { "content-type": "application/json" };
			else {
				const merged = new Headers(headers);
				if (!merged.has("content-type")) merged.set("content-type", "application/json");
				headers = merged;
			}
			return new NodeResponse(body, init ? {
				...init,
				headers
			} : { headers });
		}
		get status() {
			return this.#response?.status || this.#init?.status || 200;
		}
		get statusText() {
			return this.#response?.statusText || this.#init?.statusText || "";
		}
		get headers() {
			if (this.#response) return this.#response.headers;
			if (this.#headers) return this.#headers;
			return this.#headers = new Headers(this.#init?.headers);
		}
		get ok() {
			if (this.#response) return this.#response.ok;
			const status = this.status;
			return status >= 200 && status < 300;
		}
		get _response() {
			if (this.#response) return this.#response;
			let body = this.#body;
			if (body && typeof body.pipe === "function" && !(body instanceof Readable)) {
				const stream = new PassThrough();
				body.pipe(stream);
				const abort = body.abort;
				if (abort) stream.once("close", () => abort());
				body = stream;
			}
			let contentType;
			let contentLength;
			if (typeof body === "string") {
				contentType = "text/plain; charset=UTF-8";
				contentLength = Buffer.byteLength(body);
			} else if (body instanceof ArrayBuffer || body instanceof Uint8Array || body instanceof DataView) contentLength = body.byteLength;
			else if (body instanceof Blob) {
				contentType = body.type;
				contentLength = body.size;
			}
			let headers = this.#headers;
			if (contentLength !== void 0) {
				headers ??= new Headers(this.#init?.headers);
				if (contentType && !headers.has("content-type")) headers.set("content-type", contentType);
				if (!headers.has("content-length")) headers.set("content-length", String(contentLength));
			}
			this.#response = new NativeResponse(body, headers ? {
				...this.#init,
				headers
			} : this.#init);
			this.#init = void 0;
			this.#headers = void 0;
			this.#body = void 0;
			return this.#response;
		}
		_toNodeResponse() {
			const status = this.status;
			const statusText = this.statusText;
			let body;
			let contentType;
			let contentLength;
			if (this.#response) body = this.#response.body;
			else if (this.#body != null) {
				if (this.#body instanceof ReadableStream) body = this.#body;
				else if (typeof this.#body === "string") {
					body = this.#body;
					contentType = "text/plain; charset=UTF-8";
					contentLength = Buffer.byteLength(this.#body);
				} else if (this.#body instanceof ArrayBuffer) {
					body = Buffer.from(this.#body);
					contentLength = this.#body.byteLength;
				} else if (this.#body instanceof Uint8Array) {
					body = this.#body;
					contentLength = this.#body.byteLength;
				} else if (this.#body instanceof DataView) {
					body = Buffer.from(this.#body.buffer, this.#body.byteOffset, this.#body.byteLength);
					contentLength = this.#body.byteLength;
				} else if (this.#body instanceof Blob) {
					body = this.#body.stream();
					contentType = this.#body.type;
					contentLength = this.#body.size;
				} else if (typeof this.#body.pipe === "function") body = this.#body;
				else body = this._response.body;
			}
			const headers = [];
			const initHeaders = this.#init?.headers;
			const headerEntries = this.#response?.headers || this.#headers || (initHeaders ? Array.isArray(initHeaders) ? initHeaders : initHeaders?.entries ? initHeaders.entries() : Object.entries(initHeaders) : void 0);
			let hasContentTypeHeader;
			let hasContentLength;
			if (headerEntries) for (const [key, value] of headerEntries) {
				const lowerKey = typeof key === "string" ? key.toLowerCase() : String(key);
				if (Array.isArray(value)) for (const v of value) headers.push(lowerKey, v);
				else headers.push(lowerKey, value);
				if (lowerKey === "content-type") hasContentTypeHeader = true;
				else if (lowerKey === "content-length") hasContentLength = true;
			}
			if (contentType && !hasContentTypeHeader) headers.push("content-type", contentType);
			if (contentLength != null && !hasContentLength) headers.push("content-length", String(contentLength));
			this.#init = void 0;
			this.#headers = void 0;
			this.#response = void 0;
			this.#body = void 0;
			return {
				status,
				statusText,
				headers,
				body
			};
		}
	}
	lazyInherit(NodeResponse.prototype, NativeResponse.prototype, "_response");
	Object.setPrototypeOf(NodeResponse, NativeResponse);
	Object.setPrototypeOf(NodeResponse.prototype, NativeResponse.prototype);
	return NodeResponse;
})();
function prematureCloseError() {
	return Object.assign(/* @__PURE__ */ new Error("Connection closed before response was finished"), { code: "ERR_STREAM_PREMATURE_CLOSE" });
}
var WebRequestSocket = class extends Duplex {
	_httpMessage;
	autoSelectFamilyAttemptedAddresses = [];
	bufferSize = 0;
	bytesRead = 0;
	bytesWritten = 0;
	connecting = false;
	pending = false;
	readyState = "open";
	server = null;
	remoteAddress = "";
	remoteFamily = "";
	remotePort = 0;
	#request;
	#timeoutTimer;
	#reqReader;
	#headersWritten;
	#_writeBody;
	#resBodyController;
	#resBodyClosed;
	_webResBody;
	#tos = 0;
	constructor(request) {
		super({ allowHalfOpen: true });
		this.#request = request;
		this._webResBody = new ReadableStream({ start: (controller) => {
			this.#resBodyController = controller;
			this.#_writeBody = controller.enqueue.bind(controller);
			this.once("finish", () => {
				this.readyState = "closed";
				this.#resBodyClosed = true;
				controller.close();
			});
		} });
		if (request.signal) addAbortSignal(request.signal, this);
	}
	setTimeout(ms, cb) {
		if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return this;
		if (cb) this.on("timeout", cb);
		if (this.#timeoutTimer) clearTimeout(this.#timeoutTimer);
		if (ms > 0) this.#timeoutTimer = setTimeout(() => this.emit("timeout"), ms);
		return this;
	}
	setNoDelay() {
		return this;
	}
	setKeepAlive() {
		return this;
	}
	ref() {
		return this;
	}
	unref() {
		return this;
	}
	destroySoon() {
		this.destroy();
	}
	connect() {
		return this;
	}
	resetAndDestroy() {
		this.destroy();
		return this;
	}
	address() {
		return {
			address: "",
			family: "",
			port: 0
		};
	}
	bodyReader() {
		try {
			return this.#request.body?.getReader();
		} catch (error) {
			this.emit("error", error);
		}
	}
	getTypeOfService() {
		return this.#tos;
	}
	setTypeOfService(tos) {
		this.#tos = tos;
		return this;
	}
	_read(_size) {
		const reader = this.#reqReader ??= this.bodyReader();
		if (!reader) {
			this.push(null);
			return;
		}
		reader.read().then((res) => this._onRead(res)).catch((error) => {
			this.emit("error", error);
		});
	}
	_onRead(res) {
		if (res.done) {
			this.push(null);
			return;
		}
		if (res.value) {
			this.bytesRead += res.value.byteLength;
			this.push(res.value);
		}
	}
	_write(chunk, encoding, callback) {
		if (this.#headersWritten) this.#_writeBody(typeof chunk === "string" ? Buffer.from(chunk, encoding) : chunk);
		else if (chunk?.length > 0) {
			this.#headersWritten = true;
			const headerEnd = chunk.indexOf("\r\n\r\n");
			if (headerEnd === -1) throw new Error("Invalid HTTP headers chunk!");
			if (headerEnd < chunk.length - 4) {
				this._write(chunk.slice(headerEnd + 4), encoding, () => {
					callback(null);
				});
				return;
			}
		}
		callback(null);
	}
	_final(callback) {
		callback(null);
	}
	_destroy(err, cb) {
		if (this.#timeoutTimer) clearTimeout(this.#timeoutTimer);
		if (this.#reqReader) this.#reqReader.cancel().catch((error) => {
			console.error(error);
		});
		if (!this.#resBodyClosed) {
			this.#resBodyClosed = true;
			try {
				this.#resBodyController?.error(err ?? prematureCloseError());
			} catch {}
		}
		this.readyState = "closed";
		cb(err ?? void 0);
	}
};
var WebIncomingMessage = class extends IncomingMessage {
	#socket;
	constructor(req, socket) {
		super(socket);
		this.#socket = socket;
		this.method = req.method;
		const url = req._url ??= new FastURL(req.url);
		this.url = url.pathname + url.search;
		this.httpVersionMajor = 1;
		this.httpVersionMinor = 1;
		this.httpVersion = "1.1";
		const headers = {};
		const rawHeaders = this.rawHeaders;
		for (const [key, value] of req.headers.entries()) {
			const lowerKey = key.toLowerCase();
			if (lowerKey === "set-cookie") continue;
			headers[lowerKey] = value;
			rawHeaders.push(key, value);
		}
		const setCookie = req.headers.getSetCookie?.() ?? [];
		if (setCookie.length > 0) {
			headers["set-cookie"] = setCookie;
			for (const cookie of setCookie) rawHeaders.push("set-cookie", cookie);
		}
		if (req.method !== "GET" && req.method !== "HEAD" && !headers["content-length"] && !headers["transfer-encoding"]) headers["transfer-encoding"] = "chunked";
		this.headers = headers;
		const onData = (chunk) => {
			if (!this.push(chunk)) socket.pause();
		};
		socket.on("data", onData);
		socket.once("end", () => {
			this.complete = true;
			this.push(null);
			socket.off("data", onData);
		});
	}
	_read(_size) {
		this.#socket.resume();
	}
	_destroy(_err, cb) {
		cb();
	}
};
function callNodeHandler(handler, req) {
	const isMiddleware = handler.length > 2;
	const nodeCtx = req.runtime?.node;
	if (!nodeCtx || !nodeCtx.req || !nodeCtx.res) throw new Error("Node.js runtime context is not available.");
	const { req: nodeReq, res: nodeRes } = nodeCtx;
	let _headers;
	const webRes = new NodeResponse(void 0, {
		get status() {
			return nodeRes.statusCode;
		},
		get statusText() {
			return nodeRes.statusMessage;
		},
		get headers() {
			if (!_headers) {
				const headerEntries = [];
				const rawHeaders = nodeRes.getHeaders();
				for (const [name, value] of Object.entries(rawHeaders)) if (Array.isArray(value)) for (const v of value) headerEntries.push([name, v]);
				else if (value) headerEntries.push([name, String(value)]);
				_headers = new Headers(headerEntries);
			}
			return _headers;
		}
	});
	return new Promise((resolve, reject) => {
		nodeRes.once("close", () => resolve(webRes));
		nodeRes.once("finish", () => resolve(webRes));
		nodeRes.once("error", (error) => reject(error));
		let streamPromise;
		nodeRes.once("pipe", (stream) => {
			streamPromise = new Promise((resolve) => {
				stream.once("end", () => resolve(webRes));
				stream.once("error", (error) => reject(error));
			});
		});
		try {
			if (isMiddleware) Promise.resolve(handler(nodeReq, nodeRes, (error) => error ? reject(error) : streamPromise || resolve(webRes))).catch((error) => reject(error));
			else Promise.resolve(handler(nodeReq, nodeRes)).then(() => streamPromise || webRes).catch((error) => reject(error));
		} catch (error) {
			reject(error);
		}
	});
}
let needDrainSymbol;
function getNeedDrainSymbol(res) {
	needDrainSymbol ??= Object.getOwnPropertySymbols(res).find((s) => s.description === "kNeedDrain");
	return needDrainSymbol;
}
const NULL_BODY_STATUSES = /* @__PURE__ */ new Set([
	101,
	204,
	205,
	304
]);
const HOP_BY_HOP_HEADERS = /* @__PURE__ */ new Set([
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade"
]);
var WebServerResponse = class extends ServerResponse {
	#socket;
	#socketError;
	#onHeadersSent;
	constructor(req, socket) {
		super(req);
		this.assignSocket(socket);
		this.useChunkedEncodingByDefault = false;
		this.once("finish", () => {
			socket.end();
		});
		this.#socket = socket;
		socket.once("error", (err) => {
			this.#socketError ??= err;
		});
		socket.on("drain", () => {
			const kNeedDrain = getNeedDrainSymbol(this);
			if (kNeedDrain && !this[kNeedDrain]) return;
			if (this.destroyed || this.writableFinished) return;
			if (kNeedDrain) this[kNeedDrain] = false;
			this.emit("drain");
		});
		this.waitToFinish = this.waitToFinish.bind(this);
		this.waitForResponseHead = this.waitForResponseHead.bind(this);
		this.toWebResponse = this.toWebResponse.bind(this);
	}
	writeHead(statusCode, statusMessage, headers) {
		const result = typeof statusMessage === "string" ? super.writeHead(statusCode, statusMessage, stripTransferEncoding(headers)) : super.writeHead(statusCode, stripTransferEncoding(headers ?? statusMessage));
		this.#onHeadersSent?.();
		return result;
	}
	setHeader(name, value) {
		if (typeof name === "string" && name.toLowerCase() === "transfer-encoding") return this;
		return super.setHeader(name, value);
	}
	appendHeader(name, value) {
		if (typeof name === "string" && name.toLowerCase() === "transfer-encoding") return this;
		return super.appendHeader(name, value);
	}
	waitToFinish() {
		if (this.writableFinished) return Promise.resolve();
		if (this.#socketError || this.#socket.destroyed) return Promise.reject(this.#socketError ?? prematureCloseError());
		if (this.writableEnded) return Promise.resolve();
		return new Promise((resolve, reject) => {
			const socket = this.#socket;
			const settle = (err) => {
				this.removeListener("finish", onFinish);
				this.removeListener("error", onError);
				socket.removeListener("error", onError);
				socket.removeListener("close", onClose);
				if (err) reject(err);
				else resolve();
			};
			const onFinish = () => settle();
			const onError = (err) => settle(err);
			const onClose = () => {
				if (!this.writableFinished) settle(this.#socketError ?? prematureCloseError());
			};
			this.on("finish", onFinish);
			this.on("error", onError);
			socket.on("error", onError);
			socket.on("close", onClose);
		});
	}
	waitForResponseHead() {
		if (this.headersSent || this.writableEnded || this.writableFinished) return Promise.resolve();
		if (this.#socketError || this.#socket.destroyed) return Promise.reject(this.#socketError ?? prematureCloseError());
		return new Promise((resolve, reject) => {
			const socket = this.#socket;
			const settle = (err) => {
				this.#onHeadersSent = void 0;
				this.removeListener("finish", onFinish);
				this.removeListener("error", onError);
				socket.removeListener("error", onError);
				socket.removeListener("close", onClose);
				if (err) reject(err);
				else resolve();
			};
			this.#onHeadersSent = () => settle();
			const onFinish = () => settle();
			const onError = (err) => settle(err);
			const onClose = () => {
				if (!this.headersSent && !this.writableFinished) settle(this.#socketError ?? prematureCloseError());
			};
			this.on("finish", onFinish);
			this.on("error", onError);
			socket.on("error", onError);
			socket.on("close", onClose);
		});
	}
	async toWebResponse() {
		await this.waitForResponseHead();
		const headers = [];
		const httpHeader = this._header?.split("\r\n");
		const connectionTokens = /* @__PURE__ */ new Set();
		for (let i = 1; httpHeader && i < httpHeader.length; i++) {
			const sepIndex = httpHeader[i].indexOf(": ");
			if (sepIndex === -1) continue;
			const key = httpHeader[i].slice(0, Math.max(0, sepIndex));
			const value = httpHeader[i].slice(Math.max(0, sepIndex + 2));
			if (!key) continue;
			const lowerKey = key.toLowerCase();
			if (lowerKey === "connection") for (const token of value.split(",")) {
				const t = token.trim().toLowerCase();
				if (t) connectionTokens.add(t);
			}
			if (HOP_BY_HOP_HEADERS.has(lowerKey)) continue;
			headers.push([key, value]);
		}
		if (connectionTokens.size > 0) {
			for (let i = headers.length - 1; i >= 0; i--) if (connectionTokens.has(headers[i][0].toLowerCase())) headers.splice(i, 1);
		}
		const nullBody = NULL_BODY_STATUSES.has(this.statusCode);
		return new Response(nullBody ? null : this.#socket._webResBody, {
			status: this.statusCode,
			statusText: this.statusMessage,
			headers
		});
	}
};
function stripTransferEncoding(headers) {
	if (!headers || typeof headers !== "object") return headers;
	if (Array.isArray(headers)) {
		if (headers.length > 0 && Array.isArray(headers[0])) return headers.filter(([key]) => String(key).toLowerCase() !== "transfer-encoding");
		const out = [];
		for (let i = 0; i < headers.length; i += 2) {
			if (String(headers[i]).toLowerCase() === "transfer-encoding") continue;
			out.push(headers[i], headers[i + 1]);
		}
		return out;
	}
	let hasTransferEncoding = false;
	for (const key in headers) if (key.toLowerCase() === "transfer-encoding") {
		hasTransferEncoding = true;
		break;
	}
	if (!hasTransferEncoding) return headers;
	const out = {};
	for (const key in headers) {
		if (key.toLowerCase() === "transfer-encoding") continue;
		out[key] = headers[key];
	}
	return out;
}
async function fetchNodeHandler(handler, req) {
	const nodeRuntime = req.runtime?.node;
	if (nodeRuntime && nodeRuntime.req && nodeRuntime.res) return await callNodeHandler(handler, req);
	const socket = new WebRequestSocket(req);
	const nodeReq = new WebIncomingMessage(req, socket);
	const nodeRes = new WebServerResponse(nodeReq, socket);
	try {
		if (handler.length > 2) await new Promise((resolve, reject) => {
			nodeRes.once("finish", () => resolve());
			nodeRes.once("close", () => resolve());
			nodeRes.once("error", (error) => reject(error));
			Promise.resolve(handler(nodeReq, nodeRes, (error) => {
				if (error) return reject(error);
				if (!nodeRes.writableEnded) nodeRes.end();
				resolve();
			})).catch((error) => reject(error));
		});
		else await handler(nodeReq, nodeRes);
		return await nodeRes.toWebResponse();
	} catch (error) {
		if (!(req.signal?.aborted || error?.name === "AbortError" || error?.code === "ERR_STREAM_PREMATURE_CLOSE")) console.error(error, { cause: {
			req,
			handler
		} });
		return new Response(null, {
			status: 500,
			statusText: "Internal Server Error"
		});
	}
}
function toNodeHandler(handler, options) {
	if (handler.__nodeHandler) return handler.__nodeHandler;
	function convertedNodeHandler(nodeReq, nodeRes) {
		const res = handler(new NodeRequest({
			req: nodeReq,
			res: nodeRes,
			maxRequestBodySize: options?.maxRequestBodySize,
			trustProxy: options?.trustProxy
		}));
		return typeof res?.then === "function" ? res.then((resolvedRes) => send(nodeRes, resolvedRes)) : send(nodeRes, res);
	}
	convertedNodeHandler.__fetchHandler = handler;
	assignFnName(convertedNodeHandler, handler, " (converted to Node handler)");
	return convertedNodeHandler;
}
function send(nodeRes, webRes) {
	return sendNodeResponse(nodeRes, webRes).catch((error) => handleSendError(nodeRes, error));
}
function toFetchHandler(handler) {
	if (handler.__fetchHandler) return handler.__fetchHandler;
	function convertedNodeHandler(req) {
		return fetchNodeHandler(handler, req);
	}
	convertedNodeHandler.__nodeHandler = handler;
	assignFnName(convertedNodeHandler, handler, " (converted to Web handler)");
	return convertedNodeHandler;
}
function assignFnName(target, source, suffix) {
	if (source.name) try {
		Object.defineProperty(target, "name", { value: `${source.name}${suffix}` });
	} catch {}
}
export { NodeResponse, toFetchHandler, toNodeHandler };
