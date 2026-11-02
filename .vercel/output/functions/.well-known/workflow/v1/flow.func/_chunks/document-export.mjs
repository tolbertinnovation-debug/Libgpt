import { createRequire as __wkfCreateRequire, createRequire } from "node:module";
if (typeof require === "undefined") globalThis.require = __wkfCreateRequire(import.meta.url);
import { ARTWORK_FORMATS, DOCUMENT_FORMATS, DOCUMENT_TEMPLATES, documentMarkdown, drawingTextLines, readDocumentSpec } from "./documents.mjs";
import { PDFDocument } from "../_libs/pdfkit+png-js.mjs";
import { AlignmentType, BorderStyle, File, Footer, HeadingLevel, ImageRun, Packer, PageNumber, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "../_libs/docx.mjs";
import { zipSync } from "../_libs/fflate.mjs";
import sharp from "sharp";
// public/document-visuals.js
const palette = [
	"1B2A63",
	"196A58",
	"A64436",
	"58438A",
	"B08022",
	"26748B",
	"C46632",
	"617244",
	"834D70",
	"47546C",
	"A0785B",
	"326B65"
];
const esc$1 = (value) => String(value).replace(/[&<>"']/g, (c) => ({
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	"\"": "&quot;",
	"'": "&#39;"
})[c]);
const valueLabel = (n) => Math.abs(n) >= 1e6 || n !== 0 && Math.abs(n) < .001 ? n.toExponential(2) : n.toLocaleString("en-US", { maximumSignificantDigits: 4 });
function visualScene(block) {
	const elements = [], width = 600, height = block.type === "drawing" ? block.canvas ? 600 * block.canvas.height / block.canvas.width : block.layout === "portrait" ? 800 : block.layout === "square" ? 600 : 360 : 360;
	const text = (value, x, y, size = 11, color = "20242A", anchor = "start", weight = "body") => elements.push({
		kind: "text",
		text: String(value),
		x,
		y,
		size,
		color,
		anchor,
		weight
	});
	const line = (x, y, x2, y2, color = "CBD2DC", stroke = 1) => elements.push({
		kind: "line",
		x,
		y,
		x2,
		y2,
		color,
		stroke
	});
	const rect = (x, y, w, h, color) => elements.push({
		kind: "rect",
		x,
		y,
		w,
		h,
		color
	});
	const circle = (x, y, r, color) => elements.push({
		kind: "circle",
		x,
		y,
		r,
		color
	});
	if (block.type === "chart") {
		if (block.kind === "pie") {
			const values = block.series[0].values, total = values.reduce((a, b) => a + b, 0);
			let angle = -Math.PI / 2;
			values.forEach((value, i) => {
				const end = angle + value / total * Math.PI * 2;
				const points = [[160, 175]];
				for (let j = 0; j <= 60; j++) {
					const a = angle + (end - angle) * j / 60;
					points.push([160 + Math.cos(a) * 120, 175 + Math.sin(a) * 120]);
				}
				elements.push({
					kind: "polygon",
					points,
					color: palette[i]
				});
				angle = end;
				rect(320, 18 + i * 27, 10, 10, palette[i]);
				text(`${block.labels[i].slice(0, 22)}: ${valueLabel(value)} (${(value / total * 100).toFixed(1)}%)`, 338, 28 + i * 27, 10);
			});
		} else {
			const values = block.series.flatMap((s) => s.values), low = Math.min(0, ...values);
			const span = Math.max(0, ...values) - low || 1;
			const atY = (n) => 292 - (n - low) / span * 238;
			for (let i = 0; i <= 4; i++) {
				const n = low + span * i / 4;
				line(62, atY(n), 584, atY(n));
				text(valueLabel(n), 55, atY(n) + 3, 9, "626975", "end");
			}
			const step = 522 / block.labels.length;
			block.series.forEach((series, s) => {
				rect(65 + s * 175, 12, 10, 10, series.color);
				text(series.name.slice(0, 25), 81 + s * 175, 22, 10);
				let previous;
				series.values.forEach((value, i) => {
					const x = 62 + step * (i + .5), y = atY(value);
					if (block.kind === "bar") {
						const w = step * .75 / block.series.length;
						rect(x - step * .375 + s * w, Math.min(y, atY(0)), Math.max(1, w - 2), Math.abs(y - atY(0)), series.color);
					} else {
						if (previous) line(previous.x, previous.y, x, y, series.color, 2);
						circle(x, y, 3, series.color);
						previous = {
							x,
							y
						};
					}
				});
			});
			line(62, atY(0), 584, atY(0), "626975");
			block.labels.forEach((label, i) => text(label.slice(0, Math.max(5, Math.floor(step / 6))), 62 + step * (i + .5), 312, 9, "20242A", "middle"));
		}
		if (block.unit) text(block.unit, 300, 349, 10, "626975", "middle");
	} else if (block.type === "diagram") {
		const nodes = block.nodes.map((n) => ({
			...n,
			x: n.x * .6,
			y: n.y * .36,
			w: n.width * .6,
			h: n.height * .36
		}));
		for (const edge of block.edges) {
			const from = nodes.find((n) => n.id === edge.from), to = nodes.find((n) => n.id === edge.to);
			const dx = to.x + to.w / 2 - from.x - from.w / 2, dy = to.y + to.h / 2 - from.y - from.h / 2;
			if (!Math.hypot(dx, dy)) continue;
			const t = Math.min(to.w / 2 / (Math.abs(dx) || 1e-9), to.h / 2 / (Math.abs(dy) || 1e-9));
			const endX = to.x + to.w / 2 - dx * t, endY = to.y + to.h / 2 - dy * t;
			line(from.x + from.w / 2, from.y + from.h / 2, endX, endY, "626975", 2);
			const a = Math.atan2(dy, dx);
			elements.push({
				kind: "polygon",
				color: "626975",
				points: [
					[endX, endY],
					[endX - 9 * Math.cos(a - .45), endY - 9 * Math.sin(a - .45)],
					[endX - 9 * Math.cos(a + .45), endY - 9 * Math.sin(a + .45)]
				]
			});
		}
		nodes.forEach((n) => {
			rect(n.x, n.y, n.w, n.h, n.color);
			const size = Math.max(6, Math.min(12, Math.sqrt(n.w * n.h / Math.max(n.text.length, 1))));
			const chars = Math.max(5, Math.floor((n.w - 12) / (size * .65)));
			const parts = n.text.match(new RegExp(`.{1,${chars}}(?:\\s|$)|.{1,${chars}}`, "g")) || [n.text];
			parts.forEach((p, i) => text(p.trim(), n.x + n.w / 2, n.y + n.h / 2 + (i - (parts.length - 1) / 2) * size * 1.15 + size * .35, size, "FFFFFF", "middle"));
		});
	} else {
		const sx = width / 1e3, sy = height / 1e3;
		block.shapes.forEach((s) => {
			const start = elements.length;
			if (s.kind === "rect") {
				rect(s.x * sx, s.y * sy, s.width * sx, s.height * sy, s.color);
				elements.at(-1).radius = (s.cornerRadius || 0) * Math.min(sx, sy);
			}
			if (s.kind === "ellipse") elements.push({
				kind: "ellipse",
				x: (s.x + s.width / 2) * sx,
				y: (s.y + s.height / 2) * sy,
				rx: s.width * sx / 2,
				ry: s.height * sy / 2,
				color: s.color
			});
			if (s.kind === "polygon") elements.push({
				kind: "polygon",
				points: s.points.map(([x, y]) => [x * sx, y * sy]),
				color: s.color
			});
			if (s.kind === "circle") circle(s.x * sx, s.y * sy, s.radius * Math.min(sx, sy), s.color);
			if (s.kind === "line") line(s.x * sx, s.y * sy, s.x2 * sx, s.y2 * sy, s.color, (s.lineWidth || 3.33) * sx);
			if (s.kind === "text") {
				const size = (s.size || 20) * sx, room = (s.width || 1e3 - s.x) * sx;
				const lines = drawingTextLines(s.text, s.width || 1e3 - s.x, s.size || 20, s.tracking || 0);
				const anchor = s.align === "center" ? "middle" : s.align === "right" ? "end" : "start";
				const x = s.x * sx + (anchor === "middle" ? room / 2 : anchor === "end" ? room : 0);
				lines.forEach((line, i) => {
					const y = s.y * sy + size + i * size * (s.leading || 1.2);
					if (y <= height) {
						text(line, x, y, size, s.color, anchor, s.bold ? "strong" : "body");
						Object.assign(elements.at(-1), {
							font: s.font || "sans",
							tracking: (s.tracking || 0) * sx
						});
					}
				});
			}
			for (const e of elements.slice(start)) Object.assign(e, {
				opacity: s.opacity ?? 1,
				outline: s.stroke,
				outlineWidth: (s.strokeWidth || 2) * sx
			});
		});
	}
	if (block.type === "diagram") {
		const top = Math.max(0, Math.min(...block.nodes.map((n) => n.y * .36)) - 24);
		const bottom = Math.min(height, Math.max(...block.nodes.map((n) => (n.y + n.height) * .36)) + 24);
		for (const e of elements) {
			if (e.y != null) e.y -= top;
			if (e.y2 != null) e.y2 -= top;
			if (e.points) e.points = e.points.map(([x, y]) => [x, y - top]);
		}
		return {
			width,
			height: bottom - top,
			elements
		};
	}
	return {
		width,
		height,
		elements
	};
}
function sceneSvg(scene) {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scene.width} ${scene.height}" width="${scene.width}" height="${scene.height}" role="img">${scene.elements.map((e) => {
		const c = `#${e.color}`, appearance = `opacity="${e.opacity ?? 1}"${e.outline ? ` stroke="#${e.outline}" stroke-width="${e.outlineWidth}"` : ""}`;
		if (e.kind === "text") return `<text x="${e.x}" y="${e.y}" font-family="${e.font === "serif" ? "Georgia,serif" : "Arial,sans-serif"}" letter-spacing="${e.tracking || 0}" ${appearance} font-size="${e.size}" font-weight="${e.weight === "strong" ? 700 : 400}" fill="${c}" text-anchor="${e.anchor}">${esc$1(e.text)}</text>`;
		if (e.kind === "rect") return `<rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" rx="${e.radius || 0}" ${appearance} fill="${c}"/>`;
		if (e.kind === "ellipse") return `<ellipse cx="${e.x}" cy="${e.y}" rx="${e.rx}" ry="${e.ry}" ${appearance} fill="${c}"/>`;
		if (e.kind === "circle") return `<circle cx="${e.x}" cy="${e.y}" r="${e.r}" ${appearance} fill="${c}"/>`;
		if (e.kind === "line") return `<line x1="${e.x}" y1="${e.y}" x2="${e.x2}" y2="${e.y2}" stroke="${c}" stroke-width="${e.stroke}" opacity="${e.opacity ?? 1}" stroke-linecap="round"/>`;
		return `<polygon points="${e.points.map((p) => p.join(",")).join(" ")}" ${appearance} fill="${c}"/>`;
	}).join("")}</svg>`;
}
const visualSvg = (block) => sceneSvg(visualScene(block)).replace("role=\"img\"", `role="img" aria-label="${esc$1(block.title)}"`);
// server/document-export.js
const documentRequire = createRequire(import.meta.url);
const regular = documentRequire.resolve("@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff");
const bold = documentRequire.resolve("@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff");
const serif = documentRequire.resolve("@fontsource/noto-serif/files/noto-serif-latin-400-normal.woff");
const serifBold = documentRequire.resolve("@fontsource/noto-serif/files/noto-serif-latin-700-normal.woff");
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	"\"": "&quot;",
	"'": "&#39;"
})[c]);
const fonts = (doc, theme) => {
	doc.registerFont("body", theme.font === "serif" ? serif : regular);
	doc.registerFont("strong", theme.font === "serif" ? serifBold : bold);
	doc.registerFont("designSans", regular);
	doc.registerFont("designSansBold", bold);
	doc.registerFont("designSerif", serif);
	doc.registerFont("designSerifBold", serifBold);
};
function tableGeometry(block, totalWidth) {
	const numeric = block.columns.map((_, i) => {
		const values = block.rows.map((row) => row[i]).filter(Boolean);
		return values.length > 0 && values.every((value) => /^(?:[A-Z]{3}\s*)?[$€£]?\s*-?[\d,.]+(?:\s*%|\s*[A-Z]{3})?$/.test(value));
	});
	const weights = block.widths || block.columns.map((heading, i) => {
		const longest = Math.max(heading.length, ...block.rows.map((row) => Math.min(row[i].length, 80)));
		return Math.max(12, Math.min(numeric[i] ? 28 : 65, longest));
	});
	const minimum = totalWidth / block.columns.length * .65;
	const remaining = totalWidth - minimum * block.columns.length;
	const sum = weights.reduce((a, b) => a + b, 0);
	return {
		numeric,
		align: block.align || numeric.map((n) => n ? "right" : "left"),
		widths: weights.map((weight) => minimum + remaining * weight / sum)
	};
}
function documentPages(input) {
	const spec = readDocumentSpec(input), theme = DOCUMENT_TEMPLATES[spec.template];
	const short = spec.pageSize === "a4" ? 595.28 : 612, long = spec.pageSize === "a4" ? 841.89 : 792;
	const width = theme.landscape ? long : short, height = theme.landscape ? short : long;
	const margin = theme.landscape ? 64 : 54, bodyWidth = width - margin * 2, bottom = height - 62;
	const meter = new PDFDocument({ autoFirstPage: false });
	fonts(meter, theme);
	const pages = [];
	let page, y;
	const drawText = (text, x, at, size = 11, weight = "body", color = "#20242A") => page.elements.push({
		kind: "text",
		text,
		x,
		y: at,
		size,
		weight,
		color
	});
	const box = (x, at, w, h, fill, stroke = "") => page.elements.push({
		kind: "box",
		x,
		y: at,
		w,
		h,
		fill,
		stroke
	});
	const wrap = (text, size, weight, room) => {
		meter.font(weight).fontSize(size);
		const lines = [];
		for (const paragraph of String(text).split("\n")) {
			let line = "";
			for (const word of paragraph.split(/\s+/).filter(Boolean)) if (meter.widthOfString(word) > room) {
				if (line) {
					lines.push(line);
					line = "";
				}
				let fragment = "";
				for (const char of word) {
					if (fragment && meter.widthOfString(fragment + char) > room) {
						lines.push(fragment);
						fragment = "";
					}
					fragment += char;
				}
				line = fragment;
			} else if (line && meter.widthOfString(`${line} ${word}`) > room) {
				lines.push(line);
				line = word;
			} else line += `${line ? " " : ""}${word}`;
			lines.push(line);
		}
		return lines;
	};
	const next = () => {
		if (pages.length >= 200) throw Object.assign(/* @__PURE__ */ new Error("This volume exceeds 200 pages. Continue in a new volume."), { status: 400 });
		page = {
			width,
			height,
			elements: []
		};
		pages.push(page);
		y = 66;
		if (spec.template === "certificate") {
			box(24, 24, width - 48, height - 48, "", `#${theme.accent}`);
			box(30, 30, width - 60, height - 60, "", `#${theme.accent}`);
		} else if (spec.template !== "letter") box(0, 0, width, spec.template === "poster" ? 16 : 7, `#${theme.accent}`);
		if (pages.length > 1) {
			drawText(spec.title.slice(0, 70), margin, 30, 9, "strong", "#535A65");
			y = 62;
		}
	};
	const room = (need) => {
		if (y + need > bottom) next();
	};
	const lines = (text, { size = 11, weight = "body", indent = 0, gap = 10, center = false, color = "#20242A", bullet = false } = {}) => {
		const wrapped = wrap(text, size, weight, bodyWidth - indent);
		const step = size * 1.48;
		room(Math.min(wrapped.length, 3) * step);
		for (let i = 0; i < wrapped.length; i++) {
			const line = wrapped[i];
			if (wrapped.length - i === 2 && y + step * 2 > bottom) next();
			room(step);
			meter.font(weight).fontSize(size);
			const x = center ? (width - meter.widthOfString(line)) / 2 : margin + indent;
			if (bullet && i === 0) drawText("•", margin, y, size, weight, `#${theme.accent}`);
			drawText(line, x, y, size, weight, color);
			y += step;
		}
		y += gap;
	};
	next();
	lines(spec.title, {
		size: theme.landscape ? 29 : spec.template === "poster" ? 30 : 25,
		weight: "strong",
		gap: 12,
		center: theme.landscape,
		color: `#${theme.accent}`
	});
	if (spec.subtitle) lines(spec.subtitle, {
		size: 12,
		center: theme.landscape
	});
	if (spec.author || spec.date) lines([spec.author, spec.date].filter(Boolean).join("  |  "), {
		size: 10,
		gap: 18,
		center: theme.landscape
	});
	if (!theme.landscape && spec.template !== "letter") {
		room(16);
		box(margin, y, bodyWidth, 1, `#${theme.accent}`);
		y += 18;
	}
	for (const block of spec.blocks) {
		if (block.type === "pageBreak") {
			if (y > 70) next();
			continue;
		}
		if (block.type === "heading") {
			const size = block.level === 2 ? 12 : 14;
			room(wrap(block.text, size, "strong", bodyWidth).length * size * 1.48 + 55);
			y += 7;
			lines(block.text, {
				size,
				weight: "strong",
				gap: 8,
				center: theme.landscape,
				color: `#${theme.accent}`
			});
		}
		if (block.type === "paragraph") lines(block.text, { center: theme.landscape });
		if (block.type === "signature") {
			room(52);
			y += 16;
			lines(block.text, {
				size: 11,
				center: theme.landscape
			});
		}
		if ([
			"chart",
			"diagram",
			"drawing"
		].includes(block.type)) {
			const scene = visualScene(block), w = Math.min(bodyWidth, 420 * scene.width / scene.height), h = w * scene.height / scene.width;
			room(h + wrap(block.title, 12, "strong", bodyWidth).length * 12 * 1.48 + 18);
			lines(block.title, {
				size: 12,
				weight: "strong",
				color: `#${theme.accent}`,
				gap: 8
			});
			room(h + 10);
			page.elements.push({
				kind: "figure",
				scene,
				x: margin + (bodyWidth - w) / 2,
				y,
				w,
				h
			});
			y += h + 10;
			if (block.caption) lines(block.caption, {
				size: 9,
				color: "#626975",
				gap: 14
			});
		}
		if (block.type === "bullets") for (const item of block.items) lines(item, {
			indent: 14,
			gap: 6,
			bullet: true
		});
		if (block.type === "table") {
			if (block.caption) lines(block.caption, {
				size: 10,
				weight: "strong",
				gap: 8
			});
			const { widths, align } = tableGeometry(block, bodyWidth);
			const rowParts = (row, weight = "body") => row.map((cell, i) => wrap(cell, 10, weight, widths[i] - 16));
			const paint = (parts, header = false, shade = false, total = false) => {
				const h = Math.max(...parts.map((x) => x.length)) * 14 + 16;
				let x = margin;
				parts.forEach((part, i) => {
					box(x, y, widths[i], h, header ? `#${theme.accent}` : shade ? `#${theme.tint}` : "#FFFFFF", "#D9D9D9");
					part.forEach((line, j) => {
						meter.font(header || total ? "strong" : "body").fontSize(10);
						const at = align[i] === "right" ? x + widths[i] - 8 - meter.widthOfString(line) : align[i] === "center" ? x + (widths[i] - meter.widthOfString(line)) / 2 : x + 8;
						drawText(line, at, y + 8 + j * 14, 10, header || total ? "strong" : "body", header ? "#FFFFFF" : "#20242A");
					});
					x += widths[i];
				});
				y += h;
			};
			const header = rowParts(block.columns, "strong");
			const headerHeight = Math.max(...header.map((x) => x.length)) * 14 + 16;
			if (headerHeight > bottom - 102) throw Object.assign(/* @__PURE__ */ new Error("The table headings are too tall for the page. Shorten the headings or use fewer columns."), { status: 400 });
			room(headerHeight + 40);
			paint(header, true);
			[...block.rows, ...block.footer ? [block.footer] : []].forEach((row, index) => {
				const total = index === block.rows.length;
				const parts = rowParts(row, total ? "strong" : "body");
				let offset = 0, count = Math.max(...parts.map((x) => x.length));
				if (y + count * 14 + 16 > bottom && count * 14 + 16 <= bottom - 62 - headerHeight) {
					next();
					paint(header, true);
				}
				while (offset < count) {
					let available = Math.floor((bottom - y - 16) / 14);
					if (available < 1) {
						next();
						paint(header, true);
						available = Math.floor((bottom - y - 16) / 14);
					}
					const take = Math.min(available, count - offset);
					paint(parts.map((x) => x.slice(offset, offset + take)), false, total || index % 2 === 1, total);
					offset += take;
					if (offset < count) {
						next();
						paint(header, true);
					}
				}
			});
			y += 14;
		}
	}
	pages.forEach((p, i) => p.elements.push({
		kind: "text",
		text: `Page ${i + 1} of ${pages.length}`,
		x: margin,
		y: height - 39,
		size: 9,
		weight: "body",
		color: "#626975"
	}));
	meter.end();
	return {
		spec,
		theme,
		pages
	};
}
async function pdfExport(layout) {
	const doc = new PDFDocument({
		autoFirstPage: false,
		info: {
			Title: layout.spec.title,
			Author: layout.spec.author
		}
	});
	fonts(doc, layout.theme);
	const chunks = [];
	const ready = new Promise((resolve, reject) => {
		doc.on("data", (chunk) => chunks.push(chunk));
		doc.on("end", () => resolve(Buffer.concat(chunks)));
		doc.on("error", reject);
	});
	for (const page of layout.pages) {
		doc.addPage({
			size: [page.width, page.height],
			margin: 0
		});
		for (const e of page.elements) if (e.kind === "text") doc.font(e.weight).fontSize(e.size).fillColor(e.color).text(e.text, e.x, e.y, { lineBreak: false });
		else if (e.kind === "figure") {
			doc.save().rect(e.x, e.y, e.w, e.h).clip().translate(e.x, e.y).scale(e.w / e.scene.width);
			for (const s of e.scene.elements) {
				doc.save().opacity(s.opacity ?? 1);
				if (s.kind === "text") {
					doc.font(s.font ? `design${s.font === "serif" ? "Serif" : "Sans"}${s.weight === "strong" ? "Bold" : ""}` : s.weight === "strong" ? "strong" : "body").fontSize(s.size).fillColor(`#${s.color}`);
					const tw = doc.widthOfString(s.text, { characterSpacing: s.tracking || 0 }), x = s.x - (s.anchor === "end" ? tw : s.anchor === "middle" ? tw / 2 : 0);
					doc.text(s.text, x, s.y - s.size, {
						lineBreak: false,
						characterSpacing: s.tracking || 0
					});
				} else if (s.kind === "line") doc.moveTo(s.x, s.y).lineTo(s.x2, s.y2).lineWidth(s.stroke).strokeColor(`#${s.color}`).stroke();
				else {
					if (s.kind === "rect") doc.roundedRect(s.x, s.y, s.w, s.h, s.radius || 0);
					else if (s.kind === "circle") doc.circle(s.x, s.y, s.r);
					else if (s.kind === "ellipse") doc.ellipse(s.x, s.y, s.rx, s.ry);
					else doc.polygon(...s.points);
					if (s.outline) doc.lineWidth(s.outlineWidth).fillAndStroke(`#${s.color}`, `#${s.outline}`);
					else doc.fill(`#${s.color}`);
				}
				doc.restore();
			}
			doc.restore();
		} else {
			doc.rect(e.x, e.y, e.w, e.h);
			if (e.fill && e.stroke) doc.fillAndStroke(e.fill, e.stroke);
			else if (e.fill) doc.fill(e.fill);
			else if (e.stroke) doc.strokeColor(e.stroke).stroke();
		}
	}
	doc.end();
	return ready;
}
function pageSvg(page, theme) {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width * 2}" height="${page.height * 2}" viewBox="0 0 ${page.width} ${page.height}"><rect width="100%" height="100%" fill="white"/>${page.elements.map((e) => e.kind === "text" ? `<text x="${e.x}" y="${e.y + e.size}" font-family="${theme.font === "serif" ? "serif" : "sans-serif"}" font-size="${e.size}" font-weight="${e.weight === "strong" ? "700" : "400"}" fill="${e.color}">${esc(e.text)}</text>` : e.kind === "figure" ? `<svg x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" viewBox="0 0 ${e.scene.width} ${e.scene.height}">${sceneSvg(e.scene).replace(/^<svg[^>]*>|<\/svg>$/g, "")}</svg>` : `<rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" fill="${e.fill || "none"}" stroke="${e.stroke || "none"}"/>`).join("")}</svg>`;
}
async function wordExport(spec, theme) {
	const pageWidth = spec.pageSize === "a4" ? 11906 : 12240, pageHeight = spec.pageSize === "a4" ? 16838 : 15840;
	const font = theme.font === "serif" ? "Times New Roman" : "Arial";
	const textRuns = (text, options = {}) => String(text).split("\n").map((line, i) => new TextRun({
		text: line,
		...i ? { break: 1 } : {},
		font,
		...options
	}));
	const paragraph = (text, options = {}) => new Paragraph({
		children: textRuns(text, { color: options.heading ? theme.accent : "20242A" }),
		widowControl: true,
		spacing: {
			after: 180,
			line: 300
		},
		...theme.landscape ? { alignment: AlignmentType.CENTER } : {},
		...options
	});
	const children = [paragraph(spec.title, {
		heading: HeadingLevel.TITLE,
		keepNext: true
	})];
	if (spec.subtitle) children.push(paragraph(spec.subtitle, { keepNext: true }));
	if (spec.author || spec.date) children.push(paragraph([spec.author, spec.date].filter(Boolean).join(" | ")));
	for (const block of spec.blocks) {
		if (block.type === "heading") children.push(paragraph(block.text, {
			heading: block.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_1,
			keepNext: true
		}));
		if (block.type === "paragraph") children.push(paragraph(block.text));
		if (block.type === "signature") children.push(paragraph(block.text, { spacing: {
			before: 320,
			after: 160
		} }));
		if ([
			"chart",
			"diagram",
			"drawing"
		].includes(block.type)) {
			children.push(paragraph(block.title, {
				heading: HeadingLevel.HEADING_2,
				keepNext: true
			}));
			const scene = visualScene(block), ratio = scene.height / scene.width;
			const data = await sharp(Buffer.from(visualSvg(block))).resize(1200, Math.round(1200 * ratio)).png().toBuffer();
			const w = Math.min(theme.landscape ? 660 : 480, 520 / ratio);
			children.push(new Paragraph({ children: [new ImageRun({
				type: "png",
				data,
				transformation: {
					width: w,
					height: w * ratio
				},
				altText: {
					title: block.title,
					description: block.caption || block.title,
					name: block.title
				}
			})] }));
			if (block.caption) children.push(paragraph(block.caption));
		}
		if (block.type === "bullets") block.items.forEach((item) => children.push(paragraph(item, { bullet: { level: 0 } })));
		if (block.type === "pageBreak") children.push(new Paragraph({ pageBreakBefore: true }));
		if (block.type === "table") {
			if (block.caption) children.push(paragraph(block.caption, { keepNext: true }));
			const border = {
				style: BorderStyle.SINGLE,
				size: 4,
				color: "D9D9D9"
			};
			const geometry = tableGeometry(block, (theme.landscape ? pageHeight : pageWidth) - 2160);
			const columnWidths = geometry.widths.map(Math.round);
			children.push(new Table({
				width: {
					size: 100,
					type: WidthType.PERCENTAGE
				},
				columnWidths,
				borders: {
					top: border,
					bottom: border,
					left: border,
					right: border,
					insideHorizontal: border,
					insideVertical: border
				},
				rows: [
					block.columns,
					...block.rows,
					...block.footer ? [block.footer] : []
				].map((row, index) => new TableRow({
					tableHeader: index === 0,
					cantSplit: true,
					children: row.map((cell, column) => new TableCell({
						width: {
							size: columnWidths[column],
							type: WidthType.DXA
						},
						shading: { fill: index === 0 ? theme.accent : index % 2 === 0 ? theme.tint : "FFFFFF" },
						margins: {
							top: 100,
							bottom: 100,
							left: 120,
							right: 120
						},
						children: [new Paragraph({
							children: textRuns(cell, {
								size: 20,
								bold: index === 0 || index > block.rows.length,
								color: index === 0 ? "FFFFFF" : "20242A"
							}),
							alignment: geometry.align[column] === "right" ? AlignmentType.RIGHT : geometry.align[column] === "center" ? AlignmentType.CENTER : AlignmentType.LEFT,
							spacing: { after: 60 }
						})]
					}))
				}))
			}));
			children.push(paragraph(""));
		}
	}
	const doc = new File({
		title: spec.title,
		creator: spec.author || "Grandpa AI",
		styles: {
			default: { document: {
				run: {
					font,
					size: 22,
					color: "000000"
				},
				paragraph: { spacing: { line: 280 } }
			} },
			paragraphStyles: [
				{
					id: "Title",
					name: "Title",
					basedOn: "Normal",
					run: {
						size: 50,
						bold: true,
						color: theme.accent
					},
					paragraph: { spacing: { after: 240 } }
				},
				{
					id: "Heading1",
					name: "Heading 1",
					basedOn: "Normal",
					run: {
						size: 28,
						bold: true,
						color: theme.accent
					},
					paragraph: {
						spacing: {
							before: 280,
							after: 120
						},
						keepNext: true
					}
				},
				{
					id: "Heading2",
					name: "Heading 2",
					basedOn: "Normal",
					run: {
						size: 24,
						bold: true,
						color: theme.accent
					},
					paragraph: {
						spacing: {
							before: 200,
							after: 100
						},
						keepNext: true
					}
				}
			]
		},
		sections: [{
			properties: { page: {
				size: {
					width: theme.landscape ? pageHeight : pageWidth,
					height: theme.landscape ? pageWidth : pageHeight
				},
				margin: {
					top: 1e3,
					bottom: 1e3,
					left: 1080,
					right: 1080
				},
				...spec.template === "letter" ? {} : { borders: {
					pageBorderTop: {
						style: BorderStyle.SINGLE,
						size: 18,
						color: theme.accent,
						space: 18
					},
					...theme.landscape ? {
						pageBorderBottom: {
							style: BorderStyle.SINGLE,
							size: 18,
							color: theme.accent,
							space: 18
						},
						pageBorderLeft: {
							style: BorderStyle.SINGLE,
							size: 18,
							color: theme.accent,
							space: 18
						},
						pageBorderRight: {
							style: BorderStyle.SINGLE,
							size: 18,
							color: theme.accent,
							space: 18
						}
					} : {}
				} }
			} },
			footers: { default: new Footer({ children: [new Paragraph({
				alignment: AlignmentType.RIGHT,
				children: [new TextRun({
					children: [
						"Page ",
						PageNumber.CURRENT,
						" of ",
						PageNumber.TOTAL_PAGES
					],
					size: 18,
					color: "626975"
				})]
			})] }) },
			children
		}]
	});
	return Packer.toBuffer(doc);
}
function htmlExport(spec, theme, images = /* @__PURE__ */ new Map()) {
	const body = spec.blocks.map((b) => {
		if ([
			"chart",
			"diagram",
			"drawing"
		].includes(b.type)) return `<figure><h3>${esc(b.title)}</h3>${images.get(b) || visualSvg(b)}${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ""}</figure>`;
		if (b.type === "heading") return `<h${b.level + 1}>${esc(b.text)}</h${b.level + 1}>`;
		if (b.type === "table") {
			const { widths, align } = tableGeometry(b, 100);
			const cell = (tag, value, i) => `<${tag}${align[i] === "right" ? " class=\"number\"" : ""} style="text-align:${align[i]}">${esc(value).replace(/\n/g, "<br>")}</${tag}>`;
			return `<table>${b.caption ? `<caption>${esc(b.caption)}</caption>` : ""}<colgroup>${widths.map((w) => `<col style="width:${w.toFixed(2)}%">`).join("")}</colgroup><thead><tr>${b.columns.map((x, i) => cell("th", x, i)).join("")}</tr></thead><tbody>${b.rows.map((row) => `<tr>${row.map((x, i) => cell("td", x, i)).join("")}</tr>`).join("")}</tbody>${b.footer ? `<tfoot><tr>${b.footer.map((x, i) => cell("td", x, i)).join("")}</tr></tfoot>` : ""}</table>`;
		}
		if (b.type === "bullets") return `<ul>${b.items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
		if (b.type === "pageBreak") return "<div class=\"page-break\"></div>";
		return `<p${b.type === "signature" ? " class=\"signature\"" : ""}>${esc(b.text).replace(/\n/g, "<br>")}</p>`;
	}).join("");
	return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(spec.title)}</title><style>@page{size:${spec.pageSize === "a4" ? "A4" : "letter"} ${theme.landscape ? "landscape" : "portrait"};margin:0.75in}body{font:11pt/1.5 ${theme.font === "serif" ? "Georgia,serif" : "Arial,sans-serif"};color:#20242a;max-width:7in;margin:40px auto;padding:24px;border-top:6px solid #${theme.accent}}h1,h2,h3{color:#${theme.accent};break-after:avoid}p{orphans:3;widows:3}li{padding-left:3px}td.number,th.number{text-align:right;font-variant-numeric:tabular-nums}tr{break-inside:avoid}h1{font-size:25pt}h2{font-size:14pt;margin-top:24px}h3{font-size:12pt}table{width:100%;border-collapse:collapse;margin:18px 0}thead{display:table-header-group}th,td{border:1px solid #d9d9d9;padding:9px;text-align:left;vertical-align:middle}th{background:#${theme.accent};color:#fff}tbody tr:nth-child(even){background:#${theme.tint}}figure{margin:24px 0;break-inside:avoid}figure svg{display:block;width:100%;height:auto}figcaption,caption{font-size:9pt;color:#626975;text-align:left;margin:8px 0}tfoot{font-weight:bold;background:#${theme.tint}}.signature{margin-top:32px}.page-break{break-before:page}@media(max-width:600px){body{margin:12px;padding:12px}table{font-size:9pt}}</style></head><body><h1>${esc(spec.title)}</h1>${spec.subtitle ? `<p>${esc(spec.subtitle)}</p>` : ""}<p>${esc([spec.author, spec.date].filter(Boolean).join(" | "))}</p>${body}</body></html>`;
}
const rtfText = (text) => [...String(text)].map((c) => c === "\n" ? "\\par " : /[\\{}]/.test(c) ? `\\${c}` : c.charCodeAt(0) > 127 ? c.split("").map((u) => `\\u${u.charCodeAt(0) > 32767 ? u.charCodeAt(0) - 65536 : u.charCodeAt(0)}?`).join("") : c).join("");
async function exportDocument(input, format, { figureIndex } = {}) {
	if (!Object.hasOwn(DOCUMENT_FORMATS, format) && !(figureIndex !== void 0 && Object.hasOwn(ARTWORK_FORMATS, format)) && format !== "design-bundle") throw Object.assign(/* @__PURE__ */ new Error("Choose a supported download format."), { status: 400 });
	const spec = readDocumentSpec(input), theme = DOCUMENT_TEMPLATES[spec.template];
	if (format === "design-bundle") {
		const drawings = spec.blocks.map((b, i) => b.type === "drawing" ? i : null).filter((i) => i !== null);
		if (!drawings.length || drawings.length > 10) throw Object.assign(/* @__PURE__ */ new Error("Design bundles support 1–10 artworks. Download a larger collection individually or split it into volumes."), { status: 400 });
		const files = {};
		let bytes = 0;
		for (const index of drawings) for (const type of [
			"png",
			"svg",
			"pdf"
		]) {
			const file = await exportDocument(spec, type, { figureIndex: index });
			bytes += file.buffer.length;
			if (bytes > 41943040) throw Object.assign(/* @__PURE__ */ new Error("This design bundle exceeds 40 MB. Download the artworks individually."), { status: 400 });
			files[file.filename] = file.buffer;
		}
		files["design-notes.txt"] = Buffer.from(`${spec.title}\n\n${drawings.map((i) => `${i + 1}. ${spec.blocks[i].title}${spec.blocks[i].canvas ? ` — ${spec.blocks[i].canvas.width} × ${spec.blocks[i].canvas.height} pixels` : ""}`).join("\n")}\n\nPNG: sharing and raster editing. SVG: scalable vector artwork. PDF: full artwork page.\nDetails to confirm:\n${spec.missing.length ? spec.missing.join("\n") : "Review wording, event details and branding before publishing."}\n`);
		return {
			buffer: Buffer.from(zipSync(files, { level: 0 })),
			mime: "application/zip",
			filename: `${spec.filename}-design-bundle.zip`
		};
	}
	if (figureIndex !== void 0) {
		const figure = Number.isInteger(figureIndex) && figureIndex >= 0 ? spec.blocks[figureIndex] : null;
		if (!figure || ![
			"chart",
			"diagram",
			"drawing"
		].includes(figure.type) || !Object.hasOwn(ARTWORK_FORMATS, format)) throw Object.assign(/* @__PURE__ */ new Error("Choose a valid figure and PNG, JPEG, WebP, SVG or PDF for artwork downloads."), { status: 400 });
		if (format === "pdf") {
			const scene = visualScene(figure), width = spec.pageSize === "a4" ? 595.28 : 612, height = width * scene.height / scene.width;
			return {
				buffer: await pdfExport({
					spec,
					theme,
					pages: [{
						width,
						height,
						elements: [{
							kind: "figure",
							scene,
							x: 0,
							y: 0,
							w: width,
							h: height
						}]
					}]
				}),
				mime: "application/pdf",
				filename: `${spec.filename}-artwork-${figureIndex + 1}.pdf`
			};
		}
		const svg = Buffer.from(figure.canvas ? visualSvg(figure).replace(/ width="[^"]+" height="[^"]+"/, ` width="${figure.canvas.width}" height="${figure.canvas.height}"`) : visualSvg(figure));
		if (format === "svg") return {
			buffer: svg,
			mime: "image/svg+xml",
			filename: `${spec.filename}-artwork-${figureIndex + 1}.svg`
		};
		const image = sharp(svg).resize({
			width: figure.canvas?.width || 2e3,
			...figure.canvas ? { height: figure.canvas.height } : {}
		});
		return {
			buffer: format === "jpg" ? await image.flatten({ background: "#ffffff" }).jpeg({
				quality: 90,
				mozjpeg: true
			}).toBuffer() : format === "webp" ? await image.webp({ quality: 90 }).toBuffer() : await image.png().toBuffer(),
			mime: format === "jpg" ? "image/jpeg" : `image/${format}`,
			filename: `${spec.filename}-artwork-${figureIndex + 1}.${format}`
		};
	}
	let buffer, extension = format, mime;
	if (format === "docx") {
		buffer = await wordExport(spec, theme);
		mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
	} else if (format === "pdf") {
		buffer = await pdfExport(documentPages(spec));
		mime = "application/pdf";
	} else if (format === "html" || format === "doc") {
		const images = /* @__PURE__ */ new Map();
		if (format === "doc") for (const block of spec.blocks.filter((b) => [
			"chart",
			"diagram",
			"drawing"
		].includes(b.type))) {
			const png = await sharp(Buffer.from(visualSvg(block))).png().toBuffer();
			images.set(block, `<img alt="${esc(block.title)}" style="max-width:100%;height:auto" src="data:image/png;base64,${png.toString("base64")}">`);
		}
		buffer = Buffer.from(htmlExport(spec, theme, images));
		mime = format === "doc" ? "application/msword" : "text/html; charset=utf-8";
	} else if (format === "rtf") {
		const figures = /* @__PURE__ */ new Map();
		for (const block of spec.blocks.filter((b) => [
			"chart",
			"diagram",
			"drawing"
		].includes(b.type))) {
			const scene = visualScene(block), height = Math.round(1200 * scene.height / scene.width);
			const png = await sharp(Buffer.from(visualSvg(block))).resize(1200, height).png().toBuffer();
			figures.set(block, `{\\pict\\pngblip\\picw1200\\pich${height}\\picwgoal9000\\pichgoal${Math.round(height * 7.5)} ${png.toString("hex")}}`);
		}
		const paragraph = (text, extra = "") => `\\pard\\sa160\\sl280${extra} ${rtfText(text)}\\par `;
		const blocks = spec.blocks.map((b) => {
			if (figures.has(b)) return paragraph(b.title, "\\b") + "\\b0 " + figures.get(b) + paragraph(b.caption || "");
			if (b.type === "heading") return paragraph(b.text, "\\b\\fs28") + "\\b0\\fs22 ";
			if (b.type === "bullets") return b.items.map((x) => paragraph("• " + x, "\\li180")).join("");
			if (b.type === "pageBreak") return "\\page ";
			if (b.type === "table") {
				const geometry = tableGeometry(b, 9e3);
				return (b.caption ? paragraph(b.caption) : "") + [
					b.columns,
					...b.rows,
					...b.footer ? [b.footer] : []
				].map((row, i) => {
					let end = 0;
					const cells = geometry.widths.map((w) => `\\cellx${Math.round(end += w)}`).join("");
					return `\\trowd\\trgaph120${i === 0 ? "\\trhdr" : ""}${cells} ` + row.map((x, n) => `\\pard\\intbl${geometry.align[n] === "right" ? "\\qr" : geometry.align[n] === "center" ? "\\qc" : "\\ql"} ${i === 0 || i > b.rows.length ? "\\b " : ""}${rtfText(x)}\\b0\\cell `).join("") + "\\row ";
				}).join("");
			}
			return paragraph(b.text, b.type === "signature" ? "\\sb320" : "");
		}).join("");
		buffer = Buffer.from(`{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 ${theme.font === "serif" ? "Times New Roman" : "Arial"};}}\\paperw${theme.landscape ? spec.pageSize === "a4" ? 16838 : 15840 : spec.pageSize === "a4" ? 11906 : 12240}\\paperh${theme.landscape ? spec.pageSize === "a4" ? 11906 : 12240 : spec.pageSize === "a4" ? 16838 : 15840}\\margl1080\\margr1080\\margt1080\\margb1080\\f0\\fs22 ${paragraph(spec.title, "\\b\\fs50")}\\b0\\fs22 ${spec.subtitle ? paragraph(spec.subtitle) : ""}${paragraph([spec.author, spec.date].filter(Boolean).join(" | "))}${blocks}}`);
		mime = "application/rtf";
	} else if (format === "md" || format === "txt") {
		buffer = Buffer.from(documentMarkdown(spec));
		mime = "text/plain; charset=utf-8";
	} else {
		const layout = documentPages(spec);
		if (layout.pages.length > 30) throw Object.assign(/* @__PURE__ */ new Error("Image downloads support up to 30 pages per volume. Use PDF or Word for this longer document."), { status: 400 });
		const files = {};
		for (let i = 0; i < layout.pages.length; i++) {
			const svg = Buffer.from(pageSvg(layout.pages[i], theme));
			files[`${spec.filename}-page-${i + 1}.${format}`] = format === "png" ? await sharp(svg).png().toBuffer() : svg;
		}
		if (layout.pages.length > 1) {
			buffer = Buffer.from(zipSync(files));
			extension = "zip";
			mime = "application/zip";
		} else {
			buffer = Object.values(files)[0];
			mime = format === "png" ? "image/png" : "image/svg+xml";
		}
	}
	return {
		buffer,
		mime,
		filename: `${spec.filename}.${extension}`
	};
}
export { documentPages, exportDocument };
