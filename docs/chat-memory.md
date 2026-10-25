# Conversation memory and image progress

Chat already saves conversation messages on the current device and sends recent exchanges with each text question. Long conversations now reserve up to 12,000 characters and 16 messages for relevant earlier exchanges and user details, alongside the recent conversation. Original words and roles are retained rather than generating a summary. Earlier user/assistant exchanges are selected by relevance to the latest question; introductory details such as a name or project can also be retained. Recent corrections appear last.

The overall window remains at most 160 messages and 120,000 characters. Large single questions remain intact and are subject to the existing explicit question-size limit. Memory is bounded and relevance-based, so it cannot guarantee recall of every detail. A visible note reports messages omitted from a long conversation. Reopen the same saved chat to continue with its context. Separate chats and devices are not automatically combined, and deleting a chat removes its local history. This feature introduces no extra model calls or server-side personal data store.

Image creation now shows an indeterminate progress bar, spinner and placeholder in the conversation. No percentage is invented. Stop cancels the active image request. The indicator is removed on completion, cancellation or failure, and motion is disabled when the browser requests reduced motion.


## Saved memory across chats

Open **Settings → Saved memory** to add, edit or remove a useful personal fact, preference or correction. Below a chat answer, **Save to memory** opens an editable draft; nothing is saved until the user chooses Save. Long answers are shown as an excerpt that the user should edit before saving. Notes are not extracted automatically from old chats and are not shared with other visitors.

Up to 50 notes of 600 characters are stored in this browser. For an Ask chat or voice turn, the app selects up to 12 notes (at most 6,000 characters), prioritizing relevance and recent edits. The server validates the notes again and supplies them as user-level background, never system instructions. The latest conversation takes precedence over old notes. Build requests do not use personal memory.

Switch **Use saved memory in chats** off to stop attaching notes to future messages while keeping them available to edit. Removing a note or clearing memory stops future inclusion; it does not erase copies already present in older responses or downloaded backups. The API key does not own these notes: changing the service connection does not delete them. Clearing browser data can delete local notes and chats.

JSON backups now include saved memories. Older version-1 backups without memory remain compatible. Restore merges notes without overwriting existing IDs or duplicate text, previews the number of added memories, and refuses to exceed the 50-note limit. It preserves the destination browser’s on/off setting and rolls memory back with chats and journal if restoration fails.
