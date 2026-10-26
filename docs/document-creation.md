# Document creation in chat

Open the attachment menu and choose **Create a document**, or ask directly: “Prepare a business proposal”, “Write my CV”, or “Create a PDF training handbook”. Describe the audience, purpose, facts and desired sections. Uploaded images and supported documents can supply source material through the existing attachment pipeline.

Chat gathers a brief before producing the structured draft with a preview and download links. Follow-up requests such as “Add a budget table” or “Make the language more formal” revise the existing document. Saved chat history and backups preserve the structured draft for later export and revision.

## Guided tasks

Choose a task or describe it naturally. Business plans, project proposals, letters, graphic designs, CVs, invoices, handbooks, reports and other documents have specific intake fields. Business plans gather the offering, customers, location, purpose and financial information. Proposals gather the problem, beneficiaries, organisation, recipient, timeline and budget. Letters gather sender, recipient, purpose and key facts. Designs gather format, audience, headline, content, branding and size.

Chat asks up to three unresolved questions per turn and preserves the answers in a reviewable brief, including across saved history and backups. Answer in ordinary language, correct earlier details, or attach source material. Creation starts automatically once the required information is clear. **Create with these details**, or an explicit “Create it now”, permits labelled placeholders for missing information; the document lists details still needing completion. **Cancel task** or “Cancel this task” stops intake. Essential ambiguity can still prompt clarification instead of a misleading draft.

Business-plan and proposal instructions cover the relevant sections, milestones, risks and financial tables. Facts, market evidence, credentials, citations and signatures must come from supplied sources; financial scenarios require an explicit instruction and clear labelling. These are editable drafts to review, not a promise of perfect accuracy or unlimited resources.

## Complete business plans from one prompt

Ask for a business plan in one sentence, for example “Business plan for a bakery in Paynesville, Liberia”, or choose **Complete business plan** in **Create a document**. There is no question-and-answer intake. The only question ever asked is what the business is and where it operates, and only if the request doesn't say.

The plan follows a fixed 17-section blueprint (`server/business-plan.js`): Executive Summary, Company Description, Products and Services, Industry and Market Analysis, Competitive Analysis, SWOT Analysis, Marketing and Sales Strategy, Operations Plan, Management and Organisation, Legal and Regulatory Requirements, Implementation Plan and Milestones, Risk Analysis and Mitigation, Financial Plan, Financial Projections, Funding Request, Social and Economic Impact, and Appendices. The application adds a contents list. Each section brief names the tables, charts and diagrams it needs, such as the pricing table, SWOT table, marketing budget, operations process diagram, organisation chart, milestone and risk tables, startup costs, use-of-funds pie chart, 12-month forecast, 3-year income statement and cash flow, break-even calculation, revenue/expense/profit chart and scenario table.

Sections are written in seven batches. After each batch the server checks which section headings exist and asks for the next group, so the plan is complete only when every section is present. The default length only switches on batching and is never padded to. A page count the user asks for is still honoured with substantive annexes. Later batches receive the Executive Summary and every earlier table, so figures stay consistent. The card lists the sections still to write, and **Resume long document** continues an interrupted plan.

Asking for a complete plan counts as asking for financial projections. Supplied figures are used exactly. Missing figures become conservative assumptions stated in a Key Assumptions table, every derived number is calculated from them, and financial tables and charts are captioned as illustrative projections to replace with verified figures. Market statistics, named competitors' figures, sources, registrations and personal details are never invented: the industry is described qualitatively, market size is a bottom-up calculation from labelled assumptions, competitors are the ones the user named or competitor types, legal requirements are marked to confirm locally, and personal details are labelled placeholders listed under **Details to complete**. Review every figure before sharing the plan with a lender or investor.

The guided intake remains available for other document types.

## Templates

Report, proposal, formal letter, resume, invoice, certificate, handbook and poster templates provide distinct typography, accent colours, spacing and page treatments. Certificates use landscape pages and a decorative frame. Template selection can be changed on the document card before downloading.

Writing guidance adapts the structure to each document type and checks consistency, missing facts and supplied arithmetic. PDF and Word headings use the template accent colour. Tables give descriptive columns more room and align numeric amounts to the right; ordinary PDF table rows stay together, with repeated headers on later pages. Wrapped bullets have hanging indents, and Word preserves deliberate line breaks such as address lines. Paragraphs use controls to reduce isolated lines at page boundaries.

## Charts, graphics and advanced tables

Ask for a bar, line or pie chart using supplied data; a process/flow diagram; or a labelled schematic drawing with shapes, lines and text. Chat previews these figures alongside the document. PDF draws scalable vector figures, Word embeds high-resolution PNG figures, HTML contains trusted SVG, and RTF includes PNG figures. Word-compatible DOC includes embedded PNGs, whose display depends on the reader; prefer native DOCX for graphics. Text and Markdown retain chart values, diagram relationships, titles and captions rather than image files.

Charts use up to 12 labels and 3 series. Diagrams support up to 16 nodes and 24 connections; drawings support up to 60 simple shapes. These are schematic graphics, not generated photographs or a full CAD editor. Figures use validated primitives; model output cannot supply executable SVG, scripts or remote asset URLs. The writing instructions require supplied data or transparent calculations and prohibit fabricating chart evidence.

Tables support captions, labelled totals rows, custom relative column widths, left/centre/right alignment, up to 8 columns and 200 rows. Headers repeat across PDF and Word pages. Figures and table options survive saved chats and backups.

Graphic designs can contain original vector artwork with controlled text size, bold text, alignment and wrapping. Drawing canvases support square, portrait and landscape layouts or custom dimensions from 320 to 4096 pixels per side, with an aspect ratio from 1:4 to 4:1. Each drawing has its own **Artwork PNG**, **Artwork SVG** and **Artwork PDF** downloads. PNG and SVG honour the selected canvas dimensions; artwork PDF is a separate vector page with the drawing's aspect ratio, without document headings or margins. Logo concepts and schematic artwork use shapes and text; they do not claim trademark clearance. A4 and US Letter document page sizes are supported in PDF, Word, RTF and HTML.

## Flyer and poster design

Select **Graphic design** to choose a visual style and artwork size. Six style briefs cover modern technology, bold campaigns, elegant editorial designs, community events, clean corporate material and learning promotions. Presets offer coordinated palettes and composition guidance; the user's supplied branding and exact wording take priority. A selected style is an approved starting point, not a guarantee that every model response follows the same composition.

Common sizes include 1080 × 1080 square posts, 1080 × 1350 portrait flyers, 1080 × 1920 stories, 1920 × 1080 landscape graphics and 2480 × 3508 A4 artwork. These selections survive guided intake and control the generated drawing canvas. A4 is a high-resolution artwork preset; CMYK conversion, bleed, printer-specific profiles and photographic/logo asset placement are not provided by this vector renderer.

Drawings now support rounded rectangles, ellipses, polygons with 3–12 points, transparency, outlines and adjustable line thickness. Text can pair sans-serif and serif fonts, use letter spacing and line spacing, and preserve deliberate line breaks. Validation and all renderers share the same conservative wrapping rules and reject text that extends below the canvas. Design instructions check safe margins, visual hierarchy, contrast, exact copy, event facts and overlapping elements. These instructions guide the model; they do not guarantee perfect design quality. Original schematic illustrations can be built from shapes. Existing AI image generation remains a separate feature.

Ask for multiple alternatives to receive several drawing blocks, each with separate downloads. Follow-up revisions preserve confirmed facts and wording. Each text box supports up to 240 characters; longer copy should use several clearly arranged boxes. The artwork uses trusted primitives, with no model-supplied executable SVG or remote asset URLs.

The artwork gallery displays alternatives directly in chat with their dimensions. **Refine this design** prepares a targeted revision request identifying the selected artwork and asking to preserve other designs and confirmed facts; enter the desired changes before sending. This guides the model rather than providing a pixel-level editing guarantee.

Sharing downloads also include JPEG and WebP. JPEG uses a white background for transparent areas, while PNG and WebP retain transparency. **Download design bundle** includes each drawing as PNG, SVG and a full-page artwork PDF, plus a text note listing details to confirm. Bundles support 1–10 drawings and up to 40 MB of generated artwork; larger collections can be downloaded individually or split into volumes. All exports are generated from the saved document without another model call.

## Longer documents

There is no 10-page document limit. Select **Length** when creating a document, or ask for “a 20-page business plan” or “a handbook of more than 10 pages”. Goals from 11 to 100 pages trigger automatic section-by-section generation. Each request writes substantial new content and the server measures the trusted PDF layout. The card shows the PDF pages saved, the page goal and whether the draft is complete; Word pagination can differ.

Long writing follows the document type and approved facts. Reports, proposals, business plans and handbooks expand useful analysis, implementation detail, examples and relevant annexes. Short formats such as letters, invoices and posters must not be padded just to reach a page count; the model is instructed to clarify inappropriate scope. Blank pages, repeated material and inflated spacing are prohibited as ways to meet the goal.

Each successful section is saved before the next request. Up to eight continuation requests run automatically per session. If the provider fails, the user stops generation, or more batches are needed, the saved draft remains downloadable. **Resume long document** continues from saved content and the remaining section plan, including after reload or backup restoration. The volume bounds below still apply; use another volume for larger tasks.

Choose **Add another section**, describe the next chapter or content, and send. The server appends the new blocks while preserving earlier blocks and metadata. Each completed version remains in chat. New sections use the document headings and recent blocks for context; if a later section depends on older details, state them explicitly or attach the source again. Continuation answers also survive backups.

Capacity is not literally unlimited: model context, server resources and device storage are finite. This update increases each document volume to 400 blocks / 320 KB of structured data, up to 60 figures, and 200 PDF/image-layout pages. PNG/SVG archives support 30 pages per export; use PDF/Word or another volume for larger tasks. Generation remains staged at a suggested 100 blocks / 80 KB per response. Creating further volumes keeps large tasks manageable.

## Download formats

| Format | Output |
| --- | --- |
| PDF | Paginated document with embedded fonts and page numbers |
| DOCX | Editable native Word document with headings and tables |
| DOC | Word-compatible HTML in a `.doc` file; not the legacy binary Word format |
| RTF | Editable rich text with headings and tables |
| PNG / SVG | Page images; multiple pages download together as a ZIP |
| HTML | Styled standalone document |
| TXT / Markdown | Portable document text |

Downloads are generated from the saved draft when clicked. They download directly to the user's device; this feature does not publish a permanent public sharing URL. Image export represents the document pages. Existing AI image generation remains available separately.

## Implementation and limits

`POST /api/document` uses the configured chat/vision model to produce validated document JSON. `POST /api/document/export` renders that JSON without another model call. Exports use PDFKit, docx, Sharp and fflate; the server requires Node 20.9 or newer. No new provider credentials are required.

Text, tables and figures are validated against the per-volume bounds above. Larger image exports ask the user to use PDF or Word. Generation instructions preserve supplied facts and require placeholders or clarification rather than fabricated credentials, citations or signatures.

Tests cover intent routing, schema validation, pagination, repeated table headers, file signatures, multi-page image archives, download errors, backups and the actual Express routes with mocked model responses. Guided-task tests cover unanswered fields, answer preservation, explicit placeholder creation and retention of the brief after errors. Mobile and desktop browser checks cover creation, preview, revision, follow-up intake, reload, cancellation and real file downloads with a mocked provider. Template PDFs, Word documents and standalone artwork were rendered and visually inspected. Live model generation still needs verification with deployment credentials.
