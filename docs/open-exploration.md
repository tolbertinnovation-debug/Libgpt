# Keep exploring and keep your work

The Library now has **History**, **Wisdom**, and **Learn**, alongside stories,
names, recipes, quizzes and the journal. The History and Wisdom chips open their
respective panels directly.

Choose a topic or leave it blank to let Grandpa choose. History and Wisdom offer
Liberia, Africa and World areas. Stories also offer those areas while retaining
the existing theme, subject and branching choices. These areas are perspectives,
not a fixed list of possible content.

Use **Explore another history**, **Give me another wisdom**, or **Teach me
something else** repeatedly. The latest result, chosen topic and region are saved on the device; each panel
keeps a bounded set of recent excerpts to detect repeats. The server retries a
recent repeat or incomplete explorer response once, then reports an error instead of presenting it as new. Every request makes at most two generation attempts; provider errors are not automatically retried.
Switching panels or a failed request preserves the previous result. This reduces
recent repetition; it does not promise every generated result will always be unique.

Each result can be read aloud, kept in the journal or downloaded as text. **Check
sources in chat** opens a live research request to verify important details.
History cards themselves are generated from model knowledge, not live research;
they say so and instruct the model never to invent events, dates or quotations.
Wisdom distinguishes original reflections from attributed traditional sayings.

## Saved history

Fixed caps of 100 conversations, 100 journal entries, 12 builds and 10 build
versions are removed. Saving no longer discards older entries to meet a count
limit. When device storage is full or blocked, the app reports the failure and
preserves the previously saved data. Work still open in memory should be backed
up or downloaded before closing the page.

Backups include journal entries and continuation metadata as well as chats,
project files and build history. Restore adds new identifiers without overwriting
existing ones. Older version-1 backups remain compatible. Restore rolls back all
three stores if one write fails. The 8 MB backup byte guard and import validation
remain in place.

There is no fixed catalogue or count of permitted text generations. API credits,
provider limits, rate limits, finite model context and available device storage
still apply. This feature is ongoing exploration, not literally infinite storage,
guaranteed knowledge or free API usage.
