# Images and documents in follow-up chat

The chat now sends the latest image and document from the current conversation with each follow-up. This includes generated images, readable uploaded photos, scanned PDFs, and text documents. This provides context for answers; it does not train the underlying model or share documents with other conversations.

- Generated images are compressed to a readable JPEG before transmission. The request includes their original prompt as context, while asking the model to inspect actual pixels rather than infer content from that prompt.
- New photo uploads retain the readable compressed source alongside the display thumbnail. Older saved chats only have thumbnails; requests explicitly disclose that small details may be unreadable.
- PDFs up to 900 KB are sent as native PDF inputs, preserving scanned pages and diagrams. Invalid files are rejected before provider calls. Text files retain the existing 50,000-character limit with a visible truncation notice.
- The most recent text document remains in context after its original turn leaves the history window. The latest image and PDF are carried separately from that text window.
- Backup and restore preserve readable photos and PDF data. Vision availability and the existing attachment reading budget apply to follow-ups as well as new uploads.
- The latest image and latest document are used. Multiple-image comparison and arbitrary older-attachment selection are not implemented.

Provider schemas follow [OpenAI file input documentation](https://developers.openai.com/api/docs/guides/file-inputs): Chat Completions receives PDF `file` parts; Responses receives `input_file` parts alongside `input_image` parts.

Validation: `npm test` exercises generated-image follow-ups, uploads, context trimming, scan acceptance, backup/restore, validation, and both provider API paths through the real chat route with mocked upstream responses. A live provider response is not part of these tests.
