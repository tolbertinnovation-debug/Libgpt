# Document creation in chat

Open the attachment menu and choose **Create a document**, or ask directly: “Prepare a business proposal”, “Write my CV”, or “Create a PDF training handbook”. Describe the audience, purpose, facts and desired sections. Uploaded images and supported documents can supply source material through the existing attachment pipeline.

Chat gathers a brief before producing the structured draft with a preview and download links. Follow-up requests such as “Add a budget table” or “Make the language more formal” revise the existing document. Saved chat history and backups preserve the structured draft for later export and revision.

## Guided tasks

Choose a task or describe it naturally. Business plans, project proposals, letters, graphic designs, CVs, invoices, handbooks, reports and other documents have specific intake fields. Business plans gather the offering, customers, location, purpose and financial information. Proposals gather the problem, beneficiaries, organisation, recipient, timeline and budget. Letters gather sender, recipient, purpose and key facts. Designs gather format, audience, headline, content, branding and size.

Chat asks up to three unresolved questions per turn and preserves the answers in a reviewable brief, including across saved history and backups. Answer in ordinary language, correct earlier details, or attach source material. Creation starts automatically once the required information is clear. **Create with these details**, or an explicit “Create it now”, permits labelled placeholders for missing information; the document lists details still needing completion. **Cancel task** or “Cancel this task” stops intake. Essential ambiguity can still prompt clarification instead of a misleading draft.

Business-plan and proposal instructions cover the relevant sections, milestones, risks and financial tables. Facts, market evidence, credentials, citations and signatures must come from supplied sources; financial scenarios require an explicit instruction and clear labelling. These are editable drafts to review, not a promise of perfect accuracy or unlimited resources.

## Templates

Report, proposal, formal letter, resume, invoice, certificate, handbook and poster templates provide distinct typography, accent colours, spacing and page treatments. Certificates use landscape pages and a decorative frame. Template selection can be changed on the document card before downloading.

Writing guidance adapts the structure to each document type and checks consistency, missing facts and supplied arithmetic. PDF and Word headings use the template accent colour. Tables give descriptive columns more room and align numeric amounts to the right; ordinary PDF table rows stay together, with repeated headers on later pages. Wrapped bullets have hanging indents, and Word preserves deliberate line breaks such as address lines. Paragraphs use controls to reduce isolated lines at page boundaries.

## Charts, graphics and advanced tables

Ask for a bar, line or pie chart using supplied data; a process/flow diagram; or a labelled schematic drawing with shapes, lines and text. Chat previews these figures alongside the document. PDF draws scalable vector figures, Word embeds high-resolution PNG figures, HTML contains trusted SVG, and RTF includes PNG figures. Word-compatible DOC includes embedded PNGs, whose display depends on the reader; prefer native DOCX for graphics. Text and Markdown retain chart values, diagram relationships, titles and captions rather than image files.

Charts use up to 12 labels and 3 series. Diagrams support up to 16 nodes and 24 connections; drawings support up to 60 simple shapes. These are schematic graphics, not generated photographs or a full CAD editor. Figures use validated primitives; model output cannot supply executable SVG, scripts or remote asset URLs. The writing instructions require supplied data or transparent calculations and prohibit fabricating chart evidence.

Tables support captions, labelled totals rows, custom relative column widths, left/centre/right alignment, up to 8 columns and 200 rows. Headers repeat across PDF and Word pages. Figures and table options survive saved chats and backups.

Graphic designs can contain original vector artwork with controlled text size, bold text, alignment and wrapping. Drawing canvases support square, portrait and landscape layouts or custom dimensions from 320 to 4096 pixels per side, with an aspect ratio from 1:4 to 4:1. **Artwork PNG** and **Artwork SVG** download the first drawing separately from the document page; PNG honours a custom canvas size. Logo concepts and schematic artwork use shapes and text; they do not claim trademark clearance. A4 and US Letter page sizes are supported in PDF, Word, RTF and HTML.

## Longer documents

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
