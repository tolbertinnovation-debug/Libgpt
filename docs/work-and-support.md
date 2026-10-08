# Keeping work, checking websites, and reporting problems

These features work in the browser without a new database or support service.

## Backup and restore

Open **Settings → Backup and restore → Create backup** to download a Grandpa AI JSON file containing conversations, attached images and documents, Ritual Coding files, proposals, and the last ten saved build versions.

On another device, open the same panel, select **Restore backup**, choose the file, review the counts, and confirm. Restore adds new items and skips identifiers already present. It does not replace existing conversations or projects. The app refuses an import that exceeds its storage limits of 100 conversations or 12 builds instead of silently dropping older work. If a storage write fails, it attempts to restore the previous saved values and reports the outcome.

Backups are not encrypted. Keep them private because they contain your work and messages. Provider credentials, access-code settings, cookies, preferences, repository connections, and deployment receipts are excluded. Restored builds are local copies: reconnect GitHub or publish them separately. Preview results are discarded so imported projects can be checked on the receiving device.

Finish active chat, voice, build, publishing, or preview work before backing up or restoring. JSON imports are capped at 8 MB and validated before writing; project source files remain inert until you open a sandboxed preview.

## Check website

Open **Build → menu → Check website**. The app performs its existing file, link, JSON, startup-error, and overflow checks and adds checks for duplicate element IDs, missing accessible control names and form labels, missing fragment targets, missing image descriptions, and images that failed to load.

Up to six HTML pages are opened in the isolated check frame at 390 px and 1280 px. Each run uses its own identifier to ignore late messages from older pages. Stop checks when needed, or use **Ask AI to fix these issues** to send the findings through the existing repair flow.

These are structural and startup checks. They never click purchase buttons, submit forms, or verify external payment or backend services. Test those interactions yourself. Real browser layout and production behavior still need validation on your device.

## Report a problem

Open **Settings → Report a problem**, or use **Report** below an AI answer. Choose a category, describe what happened, and create a report to review.

The selected answer is included only if you tick the checkbox. Chat history, source files, recordings, cookies, and API configuration are not attached. Browser, connection state, current area, and screen width help the team reproduce the issue. Common pasted API keys, Bearer tokens, and access-code headers are redacted, but still review the report for private information.

Copy or download the report and send it through your usual Grandpa AI support contact. Creating a report does not automatically submit it to a server.

