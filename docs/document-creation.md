# Document creation in chat

Open the attachment menu and choose **Create a document**, or ask directly: “Prepare a business proposal”, “Write my CV”, or “Create a PDF training handbook”. Describe the audience, purpose, facts and desired sections. Uploaded images and supported documents can supply source material through the existing attachment pipeline.

Chat produces a complete structured draft with a preview and download links. Missing nonessential details appear as explicit placeholders; essential missing information prompts clarification. Follow-up requests such as “Add a budget table” or “Make the language more formal” revise the existing document. Saved chat history and backups preserve the structured draft for later export and revision.

## Templates

Report, proposal, formal letter, resume, invoice, certificate, handbook and poster templates provide distinct typography, accent colours, spacing and page treatments. Certificates use landscape pages and a decorative frame. Template selection can be changed on the document card before downloading.

## Downloads

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

Drafts are bounded to 80 KB of JSON and 100 blocks, with bounded text, tables and lists. PDF and image layout is limited to 50 pages; PNG/SVG exports are limited to 12 pages. Larger image exports ask the user to use PDF or Word. Generation instructions preserve supplied facts and require placeholders or clarification rather than fabricated credentials, citations or signatures.

Tests cover intent routing, schema validation, pagination, repeated table headers, file signatures, multi-page image archives, download errors, backups and the actual Express routes with mocked model responses. Mobile and desktop browser checks cover creation, preview, revision and a real PDF download. Template PDFs and Word documents were rendered and visually inspected. Live model generation still needs verification with deployment credentials.
