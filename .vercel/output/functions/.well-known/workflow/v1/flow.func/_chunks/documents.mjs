import { createRequire as __wkfCreateRequire } from "node:module";
if (typeof require === "undefined") globalThis.require = __wkfCreateRequire(import.meta.url);
// public/document-length.js
function requestedDocumentPages(value) {
	const text = String(value || "");
	const above = text.match(/(?:more than|over|at least)\s+(\d{1,3})\s*(?:pages?|[- ]page)/i);
	if (above) return Math.min(100, Number(above[1]) + (/more than|over/i.test(above[0]) ? 1 : 0));
	const range = text.match(/\b(\d{1,3})\s*(?:-|–|to)\s*(\d{1,3})\s*pages?\b/i);
	const count = range ? Number(range[2]) : Number(text.match(/\b(\d{1,3})\s*[- ]?pages?\b/i)?.[1] || 0);
	return count ? Math.min(100, Math.max(1, count)) : 0;
}
function readLongForm(value) {
	if (!value || !Number.isInteger(value.targetPages) || value.targetPages < 11 || value.targetPages > 100 || !Number.isInteger(value.pageCount) || value.pageCount < 1 || value.pageCount > 200 || !Number.isInteger(value.rounds) || value.rounds < 1 || value.rounds > 100 || typeof value.complete !== "boolean" || !Array.isArray(value.remainingSections) || value.remainingSections.length > 24 || value.remainingSections.some((s) => typeof s !== "string" || !s.trim() || s.length > 200)) throw Object.assign(/* @__PURE__ */ new Error("Invalid long-document progress."), { status: 400 });
	return {
		targetPages: value.targetPages,
		pageCount: value.pageCount,
		rounds: value.rounds,
		complete: value.complete,
		remainingSections: value.remainingSections.map((s) => s.trim())
	};
}
// public/document-design.js
const DESIGN_STYLES = {
	modern_tech: {
		label: "Modern technology",
		colors: [
			"10263D",
			"00B7A8",
			"EFF9FA"
		],
		guidance: "Dark navy ground, teal highlights, a large asymmetric headline, geometric technology illustration, generous whitespace and a clear rounded call-to-action."
	},
	bold_campaign: {
		label: "Bold campaign",
		colors: [
			"B52935",
			"142F4C",
			"FFFFFF"
		],
		guidance: "Red, navy and white colour blocking, oversized short sans-serif headline, purposeful diagonal geometry, strong hierarchy and a high-contrast action panel."
	},
	elegant_editorial: {
		label: "Elegant editorial",
		colors: [
			"26342D",
			"C09A58",
			"FCF8EF"
		],
		guidance: "Cream ground, restrained forest green and gold, serif headline paired with sans-serif supporting text, thin rules, balanced margins and a calm premium composition."
	},
	community_event: {
		label: "Community event",
		colors: [
			"12665C",
			"E79B43",
			"FFF4DF"
		],
		guidance: "Warm cream and deep green with amber accents, simple geometric cultural motifs, welcoming typography, prominent event details and a useful action panel."
	},
	clean_corporate: {
		label: "Clean corporate",
		colors: [
			"153A60",
			"2B75A8",
			"FFFFFF"
		],
		guidance: "White background, blue accents, consistent alignment, concise information cards, fine dividers and a clear professional call-to-action."
	},
	learning_promo: {
		label: "Learning promotion",
		colors: [
			"552B75",
			"D9B54A",
			"F7F3FC"
		],
		guidance: "Purple and warm gold, an original book/computer illustration built from shapes, a confident headline, clearly grouped learning benefits and a prominent registration action."
	}
};
const DESIGN_SIZES = {
	square: {
		label: "Square post · 1080 × 1080",
		width: 1080,
		height: 1080
	},
	portrait: {
		label: "Portrait flyer · 1080 × 1350",
		width: 1080,
		height: 1350
	},
	story: {
		label: "Story · 1080 × 1920",
		width: 1080,
		height: 1920
	},
	a4: {
		label: "A4 print · 2480 × 3508",
		width: 2480,
		height: 3508
	},
	landscape: {
		label: "Landscape · 1920 × 1080",
		width: 1920,
		height: 1080
	}
};
const ARTWORK_FORMATS = {
	png: "PNG",
	jpg: "JPEG",
	webp: "WebP",
	svg: "SVG",
	pdf: "PDF"
};
function drawingTextLines(value, width, size, tracking = 0) {
	const limit = Math.max(1, Math.floor(width / (size * .64 + tracking)));
	const lines = [];
	for (const paragraph of String(value).split("\n")) {
		let remaining = paragraph.trim();
		if (!remaining) {
			lines.push("");
			continue;
		}
		while (remaining.length > limit) {
			const split = remaining.lastIndexOf(" ", limit);
			const at = split > 0 ? split : limit;
			lines.push(remaining.slice(0, at).trim());
			remaining = remaining.slice(at).trimStart();
		}
		lines.push(remaining);
	}
	return lines;
}
// public/documents.js
const DOCUMENT_TEMPLATES = {
	report: {
		label: "Business report",
		accent: "1B2A63",
		tint: "EDF2FA",
		font: "sans",
		landscape: false
	},
	proposal: {
		label: "Executive proposal",
		accent: "145D64",
		tint: "EDF7F5",
		font: "sans",
		landscape: false
	},
	letter: {
		label: "Formal letter",
		accent: "655143",
		tint: "F7F3EF",
		font: "serif",
		landscape: false
	},
	resume: {
		label: "Modern CV",
		accent: "263342",
		tint: "F0F3F6",
		font: "sans",
		landscape: false
	},
	invoice: {
		label: "Invoice and receipt",
		accent: "196A58",
		tint: "EDF7F2",
		font: "sans",
		landscape: false
	},
	certificate: {
		label: "Certificate",
		accent: "947426",
		tint: "FBF7EA",
		font: "serif",
		landscape: true
	},
	handbook: {
		label: "Education and handbook",
		accent: "58438A",
		tint: "F3F0FA",
		font: "sans",
		landscape: false
	},
	poster: {
		label: "Event and announcement",
		accent: "A64436",
		tint: "FFF2EE",
		font: "sans",
		landscape: false
	}
};
const DOCUMENT_FORMATS = {
	pdf: "PDF",
	docx: "Word DOCX",
	doc: "Word DOC compatible",
	rtf: "Rich text",
	png: "PNG images",
	svg: "SVG images",
	html: "HTML",
	txt: "Text",
	md: "Markdown"
};
const fail = (message) => {
	throw Object.assign(new Error(message), { status: 400 });
};
const text = (value, limit, label, optional = false) => {
	if (optional && value == null) return "";
	if (typeof value !== "string" || value.length > limit || !optional && !value.trim()) fail(`Invalid ${label}.`);
	return value.trim();
};
function readDocumentSpec(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) fail("No document was supplied.");
	const spec = {
		title: text(value.title, 200, "document title"),
		subtitle: text(value.subtitle, 300, "subtitle", true),
		author: text(value.author, 200, "author", true),
		date: text(value.date, 100, "date", true),
		template: Object.hasOwn(DOCUMENT_TEMPLATES, value.template) ? value.template : "report",
		pageSize: value.pageSize === "a4" ? "a4" : "letter",
		filename: String(value.filename || value.title).replace(/[^a-zA-Z0-9 -]/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "grandpa-document",
		missing: [],
		blocks: []
	};
	if (value.longForm != null) spec.longForm = readLongForm(value.longForm);
	if (value.blueprint === "business_plan") spec.blueprint = "business_plan";
	if (value.missing != null && (!Array.isArray(value.missing) || value.missing.length > 20)) fail("Invalid missing details.");
	spec.missing = (value.missing || []).map((x) => text(x, 200, "missing detail"));
	if (!Array.isArray(value.blocks) || !value.blocks.length || value.blocks.length > 400) fail("A document needs between 1 and 400 content blocks. Start a new volume for a larger document.");
	spec.blocks = value.blocks.map((block) => {
		if (!block || typeof block !== "object") fail("Invalid document block.");
		if ([
			"paragraph",
			"heading",
			"signature"
		].includes(block.type)) return {
			type: block.type,
			text: text(block.text, block.type === "paragraph" ? 6e3 : 400, "block text"),
			...block.type === "heading" ? { level: block.level === 2 ? 2 : 1 } : {}
		};
		if (block.type === "bullets") {
			if (!Array.isArray(block.items) || !block.items.length || block.items.length > 30) fail("Invalid list.");
			return {
				type: "bullets",
				items: block.items.map((x) => text(x, 1500, "list item"))
			};
		}
		if (block.type === "table") {
			if (!Array.isArray(block.columns) || !block.columns.length || block.columns.length > 8 || !Array.isArray(block.rows) || block.rows.length > 200) fail("Tables support up to 8 columns and 200 rows. Split larger tables into sections.");
			const columns = block.columns.map((x) => text(x, 100, "table heading"));
			const result = {
				type: "table",
				columns,
				rows: block.rows.map((row) => {
					if (!Array.isArray(row) || row.length !== columns.length) fail("Table rows must match their headings.");
					return row.map((x) => text(x, 500, "table cell", true));
				})
			};
			if (block.caption) result.caption = text(block.caption, 300, "table caption");
			if (block.align) {
				if (!Array.isArray(block.align) || block.align.length !== columns.length || block.align.some((x) => ![
					"left",
					"center",
					"right"
				].includes(x))) fail("Invalid table alignment.");
				result.align = block.align;
			}
			if (block.widths) {
				if (!Array.isArray(block.widths) || block.widths.length !== columns.length || block.widths.some((x) => !Number.isFinite(x) || x < 1 || x > 10)) fail("Invalid table column widths.");
				result.widths = block.widths;
			}
			if (block.footer) {
				if (!Array.isArray(block.footer) || block.footer.length !== columns.length) fail("Invalid table totals row.");
				result.footer = block.footer.map((x) => text(x, 500, "total cell", true));
			}
			return result;
		}
		if ([
			"chart",
			"diagram",
			"drawing"
		].includes(block.type)) return readVisual(block);
		if (block.type === "pageBreak") return { type: "pageBreak" };
		fail("Unsupported document content.");
	});
	if (spec.blocks.filter((b) => [
		"chart",
		"diagram",
		"drawing"
	].includes(b.type)).length > 60) fail("This volume has more than 60 figures. Continue in a new volume.");
	if (JSON.stringify(spec).length > 32e4) fail("This volume is too large. Continue in a new document volume.");
	return spec;
}
function readVisual(block) {
	const base = {
		type: block.type,
		title: text(block.title, 200, "figure title").replace(/\s+/g, " "),
		caption: text(block.caption, 500, "figure caption", true)
	};
	const number = (n, min, max) => {
		if (!Number.isFinite(n) || n < min || n > max) fail("Invalid figure number.");
		return n;
	};
	const colour = (c) => {
		if (c == null) return "1B2A63";
		if (!/^[0-9a-f]{6}$/i.test(c)) fail("Invalid figure colour.");
		return c;
	};
	if (block.type === "chart") {
		if (![
			"bar",
			"line",
			"pie"
		].includes(block.kind) || !Array.isArray(block.labels) || !block.labels.length || block.labels.length > 12 || !Array.isArray(block.series) || !block.series.length || block.series.length > 3) fail("Invalid chart dimensions.");
		const labels = block.labels.map((x) => text(x, 40, "chart label"));
		const series = block.series.map((s, index) => {
			if (!s || typeof s !== "object") fail("Invalid chart series.");
			if (!Array.isArray(s.values) || s.values.length !== labels.length) fail("Chart values must match labels.");
			return {
				name: text(s.name, 60, "series name"),
				values: s.values.map((n) => number(n, -0xe8d4a51000, 0xe8d4a51000)),
				color: colour(s.color ?? [
					"1B2A63",
					"196A58",
					"A64436"
				][index])
			};
		});
		if (block.kind === "pie" && (series.length !== 1 || series[0].values.some((n) => n < 0) || series[0].values.every((n) => n === 0))) fail("Pie charts require one nonnegative series with a positive total.");
		return {
			...base,
			kind: block.kind,
			labels,
			series,
			unit: text(block.unit, 40, "chart unit", true)
		};
	}
	if (block.type === "diagram") {
		if (!Array.isArray(block.nodes) || !block.nodes.length || block.nodes.length > 16 || !Array.isArray(block.edges) || block.edges.length > 24) fail("Invalid diagram dimensions.");
		const ids = /* @__PURE__ */ new Set();
		const nodes = block.nodes.map((n) => {
			if (!n || typeof n !== "object") fail("Invalid diagram node.");
			const id = text(n.id, 40, "node id");
			if (ids.has(id)) fail("Duplicate diagram node.");
			ids.add(id);
			return {
				id,
				text: text(n.text, 120, "node text"),
				x: number(n.x, 0, 850),
				y: number(n.y, 0, 850),
				width: number(n.width ?? 220, 80, 400),
				height: number(n.height ?? 120, 60, 250),
				color: colour(n.color)
			};
		});
		if (nodes.some((n) => n.x + n.width > 1e3 || n.y + n.height > 1e3)) fail("Diagram nodes must fit the canvas.");
		const edges = block.edges.map((e) => {
			if (!e || !ids.has(e.from) || !ids.has(e.to)) fail("Diagram edges must reference existing nodes.");
			return {
				from: e.from,
				to: e.to
			};
		});
		return {
			...base,
			nodes,
			edges
		};
	}
	if (!Array.isArray(block.shapes) || !block.shapes.length || block.shapes.length > 60) fail("Invalid drawing dimensions.");
	const shapes = block.shapes.map((s) => {
		if (!s || typeof s !== "object") fail("Invalid drawing shape.");
		if (![
			"rect",
			"circle",
			"ellipse",
			"polygon",
			"line",
			"text"
		].includes(s.kind)) fail("Unsupported drawing shape.");
		const decoration = {
			opacity: number(s.opacity ?? 1, 0, 1),
			...s.stroke != null ? {
				stroke: colour(s.stroke),
				strokeWidth: number(s.strokeWidth ?? 2, .5, 20)
			} : {}
		};
		if (s.kind === "polygon") {
			if (!Array.isArray(s.points) || s.points.length < 3 || s.points.length > 12 || s.points.some((p) => !Array.isArray(p) || p.length !== 2)) fail("Polygons need 3 to 12 coordinate pairs.");
			return {
				kind: "polygon",
				color: colour(s.color),
				points: s.points.map((p) => [number(p[0], 0, 1e3), number(p[1], 0, 1e3)]),
				...decoration
			};
		}
		const shape = {
			kind: s.kind,
			x: number(s.x, 0, 1e3),
			y: number(s.y, 0, 1e3),
			color: colour(s.color)
		};
		if (s.kind === "text") {
			shape.text = text(s.text, 240, "drawing text");
			shape.size = number(s.size ?? 20, 12, 120);
			shape.width = number(s.width ?? 1e3 - shape.x, 1, 1e3 - shape.x);
			if (s.align != null && ![
				"left",
				"center",
				"right"
			].includes(s.align)) fail("Invalid drawing text alignment.");
			shape.align = s.align || "left";
			shape.bold = s.bold === true;
			if (s.font != null && !["sans", "serif"].includes(s.font)) fail("Invalid artwork font.");
			shape.font = s.font || "sans";
			shape.leading = number(s.leading ?? 1.2, 1, 2);
			shape.tracking = number(s.tracking ?? 0, 0, 12);
		}
		if (s.kind === "line") {
			shape.x2 = number(s.x2, 0, 1e3);
			shape.y2 = number(s.y2, 0, 1e3);
			shape.lineWidth = number(s.lineWidth ?? 3.33, .5, 20);
		}
		if (s.kind === "circle") {
			shape.radius = number(s.radius, 1, 250);
			if (shape.x - shape.radius < 0 || shape.x + shape.radius > 1e3 || shape.y - shape.radius < 0 || shape.y + shape.radius > 1e3) fail("Circle must fit the canvas.");
		}
		if (["rect", "ellipse"].includes(s.kind)) {
			shape.width = number(s.width, 1, 1e3);
			shape.height = number(s.height, 1, 1e3);
			if (shape.x + shape.width > 1e3 || shape.y + shape.height > 1e3) fail("Shape must fit the canvas.");
			if (s.kind === "rect") shape.cornerRadius = number(s.cornerRadius ?? 0, 0, Math.min(shape.width, shape.height) / 2);
		}
		return {
			...shape,
			...decoration
		};
	});
	if (block.layout != null && ![
		"landscape",
		"square",
		"portrait"
	].includes(block.layout)) fail("Invalid drawing layout.");
	let canvas;
	if (block.canvas != null) {
		if (!block.canvas || typeof block.canvas !== "object") fail("Invalid artwork canvas.");
		const width = number(block.canvas.width, 320, 4096), height = number(block.canvas.height, 320, 4096);
		if (!Number.isInteger(width) || !Number.isInteger(height) || width / height < .25 || width / height > 4) fail("Invalid artwork canvas proportions.");
		canvas = {
			width,
			height
		};
	}
	const canvasHeight = canvas ? 600 * canvas.height / canvas.width : block.layout === "portrait" ? 800 : block.layout === "square" ? 600 : 360;
	for (const shape of shapes.filter((s) => s.kind === "text")) {
		const rows = drawingTextLines(shape.text, shape.width, shape.size, shape.tracking).length;
		if (shape.y * canvasHeight / 1e3 + shape.size * .6 * (1 + (rows - 1) * shape.leading) + shape.size * .15 > canvasHeight - 2) fail("Drawing text does not fit the canvas. Shorten the text or move the text box.");
	}
	return {
		...base,
		shapes,
		layout: block.layout || "landscape",
		...canvas ? { canvas } : {}
	};
}
function documentMarkdown(spec) {
	const tableCell = (value) => String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
	return [
		`# ${spec.title}`,
		spec.subtitle,
		[spec.author, spec.date].filter(Boolean).join(" · "),
		...spec.blocks.map((b) => {
			if (b.type === "heading") return `${b.level === 2 ? "###" : "##"} ${b.text}`;
			if (b.type === "bullets") return b.items.map((x) => `- ${x}`).join("\n");
			if (b.type === "table") return [b.caption, ...[
				b.columns.map(tableCell).join(" | "),
				b.columns.map(() => "---").join(" | "),
				...[...b.rows, ...b.footer ? [b.footer] : []].map((r) => r.map(tableCell).join(" | "))
			].map((r) => `| ${r} |`)].filter(Boolean).join("\n");
			if (b.type === "chart") return [
				b.title,
				b.caption,
				b.unit,
				...b.labels.map((label, i) => `${label}: ${b.series.map((s) => `${s.name} ${s.values[i]}`).join("; ")}`)
			].filter(Boolean).join("\n");
			if (b.type === "diagram") return [
				b.title,
				b.caption,
				...b.nodes.map((n) => n.text),
				...b.edges.map((e) => `${b.nodes.find((n) => n.id === e.from).text} → ${b.nodes.find((n) => n.id === e.to).text}`)
			].filter(Boolean).join("\n");
			if (b.type === "drawing") return [
				b.title,
				b.caption,
				...b.shapes.filter((s) => s.kind === "text").map((s) => s.text)
			].filter(Boolean).join("\n");
			return b.text || "";
		})
	].filter(Boolean).join("\n\n");
}
export { ARTWORK_FORMATS, DESIGN_SIZES, DESIGN_STYLES, DOCUMENT_FORMATS, DOCUMENT_TEMPLATES, documentMarkdown, drawingTextLines, readDocumentSpec, requestedDocumentPages };
