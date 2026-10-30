// A short running summary of the start of a very long conversation. Only the
// most recent messages and a few recalled ones fit in what is sent with each
// question; the summary keeps names, facts and decisions from the rest, so
// hours in, Grandpa still knows what was agreed. It is written by the small,
// cheap model, and only when messages are actually being left out.

export const KEEP_RECENT = 40;       // the newest messages are never summarised
export const REFRESH_EVERY = 20;     // re-summarise after this many more messages
export const SUMMARY_LIMIT = 3000;   // characters kept
const PART_LIMIT = 1200, BATCH_LIMIT = 24000;

const usable = messages => (Array.isArray(messages) ? messages : [])
  .filter(m => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string');

/** A summary that came from storage or a server, or '' when it is not one. */
export function cleanSummary(value) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, SUMMARY_LIMIT) : '';
}

/** Whether this chat needs its summary written or brought up to date before sending. */
export function needsSummary(chat, dropped) {
  if (!(dropped > 0)) return false;
  const upTo = usable(chat?.messages).length - KEEP_RECENT;
  if (upTo <= 0) return false;
  const done = Number.isSafeInteger(chat?.summary?.upTo) && cleanSummary(chat.summary.text) ? chat.summary.upTo : 0;
  return upTo - done >= (done ? REFRESH_EVERY : 1);
}

/** What to send to /api/summary: the summary so far and the messages since it, bounded. */
export function summaryRequest(chat) {
  const list = usable(chat?.messages);
  const upTo = Math.max(0, list.length - KEEP_RECENT);
  const previous = Number.isSafeInteger(chat?.summary?.upTo) ? cleanSummary(chat.summary.text) : '';
  const from = previous ? Math.min(chat.summary.upTo, upTo) : 0;
  const part = list.slice(from, upTo);
  // Every message is kept, shortened as needed, so the start (where names and
  // facts usually are) is never the part that falls away. Only a backlog too
  // big even for that keeps its first and its most recent messages.
  const per = Math.max(120, Math.min(PART_LIMIT, Math.floor(BATCH_LIMIT / Math.max(1, part.length))));
  const shorten = m => ({ role: m.role, content: m.content.length > per ? `${m.content.slice(0, per)} …` : m.content });
  let messages = part.map(shorten);
  if (messages.length * per > BATCH_LIMIT) {
    const room = Math.floor(BATCH_LIMIT / per), head = Math.floor(room / 3);
    messages = [...messages.slice(0, head), ...messages.slice(messages.length - (room - head))];
  }
  return { upTo, body: { previous, messages } };
}
