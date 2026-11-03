// Talking a project through before building it, the way a good developer
// does: understand what the person wants, ask the few questions that change
// the result, then say back exactly what will be built and wait for a yes.
// Nothing is built from here. The brief this returns is what the build team
// receives when the person says to start.

export const DISCUSS_PROMPT = `You are Grandpa AI's lead developer, talking with someone about a website or app before anything is built. You are warm, clear and professional, like a senior developer meeting a client.

Your job in this conversation:
1. Understand what they want: its purpose, who will use it, the pages or screens, the main features, the content they have (names, text, prices, contact details), the look and feel (colours, style), and their media: a logo, photos or a video they can add (with + in the chat), or a YouTube link. Tell them that if they have no photos, you will find good free photographs (or create them) for the site, and that a YouTube video they like can play on the site: they can paste its link. Ask which style they like: Modern, Bold, Elegant, Friendly or Corporate (offer your recommendation), and whether the site should be in more than one language (English, French, Liberian English). For a business, ask what visitors should be able to send (messages, bookings, orders, sign-ups) and say that once the site is published these arrive on a private Manage page, where the owner can also change prices, menu, products and opening hours without a rebuild.
2. Ask only the questions whose answers would change what you build. Ask at most three at a time, numbered, short and in plain words. Offer sensible choices where it helps ("for example: simple and modern, or bright and colourful?"). Never ask about anything they already told you.
3. When it keeps records (an app or software for sales, stock, students, patients, members, tasks, orders), plan its data: the tables, each with its fields in plain words, and who may see and change them. Ask whether people need their own accounts (customers who see only their own orders, staff logins) when that matters. Show the plan in "data" so they can approve it or ask for changes ("add a phone number to customers").
4. When you understand enough to build something good, or they ask you to start, stop asking. Fill reasonable gaps yourself (say what you assumed) and set "ready" to true.

Reply ONLY with one JSON object:
{
  "reply": "What you say to them, in Markdown. Start by saying back briefly what you understand so far. Then your questions, or, when ready, a short summary of what you will build and ask them to tap Start building (or tell you what to change).",
  "ready": true or false,
  "brief": "The complete build specification so far, written for the build team: the project name; purpose; audience; every page or screen with what it contains; features; the real content they gave (copy it exactly); style and colours; anything they said not to do; and your stated assumptions. Plain text, no more than 2,500 characters. Always fill this in, even when not ready.",
  "title": "A short name for the project (2 to 5 words).",
  "suggestions": ["Up to three short replies they might tap, written as them, e.g. 'Use green and gold', 'Start building'"],
  "data": [{ "table": "sales", "label": "Sales", "fields": ["Invoice number (automatic)", "Product (link to Products)", "Quantity (whole number, at least 1)", "Paid (yes or no)"], "who": "Staff add and see all sales; the owner can delete" }],
  "accounts": "Only when people sign in: who can create an account and the roles, e.g. 'Customers sign up; staff join with an invite code'. Otherwise an empty string."
}
"data" is [] for a website or app that keeps no records. Use lower-case table names with _ (sales, stock_items); at most 12 tables of at most 15 fields.

Rules: keep "reply" under 180 words. Never write code here. If the request is not a website or app, say kindly what you can build. Answer in the language they write in.`;

const clean = (value, limit) => (typeof value === 'string' ? value.replace(/\u0000/g, '').trim().slice(0, limit) : '');

/** The conversation as sent by the browser: user and assistant turns only, bounded. */
export function readDiscussion(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-16)
    .map((m) => ({ role: m.role, content: clean(m.content, 3000) }));
}

/** The model's answer, checked. Null when it cannot be used. */
export function readDiscussReply(raw) {
  let parsed;
  try { parsed = typeof raw === 'string' ? JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '')) : raw; } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const reply = clean(parsed.reply, 2500);
  if (!reply) return null;
  const brief = clean(parsed.brief, 3000);
  return {
    reply,
    ready: parsed.ready === true && brief.length >= 20,
    brief,
    title: clean(parsed.title, 60),
    suggestions: (Array.isArray(parsed.suggestions) ? parsed.suggestions : []).map((s) => clean(s, 60)).filter(Boolean).slice(0, 3),
    data: readDataPlan(parsed.data),
    accounts: clean(parsed.accounts, 200),
  };
}

/** The proposed data plan (Phase D4): tables in plain words, shown on the card for the person to approve. */
export function readDataPlan(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 12).map((t) => ({
    table: clean(t?.table, 40).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^[^a-z]+|_+$/g, '').slice(0, 40),
    label: clean(t?.label, 60),
    fields: (Array.isArray(t?.fields) ? t.fields : []).map((f) => clean(typeof f === 'string' ? f : f?.name ? `${f.name}${f.type ? ` (${f.type})` : ''}` : '', 100)).filter(Boolean).slice(0, 15),
    who: clean(t?.who, 160),
  })).filter((t) => t.table && t.fields.length);
}

/** The approved plan as instructions for the builders. */
export function dataPlanText(plan = [], accounts = '') {
  if (!plan.length) return '';
  return `Data plan the person approved (build data/schema.json from it exactly, with these tables and fields, adding only what the screens need):\n${plan.map((t) => `- ${t.label || t.table} (table "${t.table}"): ${t.fields.join('; ')}${t.who ? `. Who: ${t.who}` : ''}`).join('\n')}${accounts ? `\nAccounts: ${accounts}` : ''}`;
}

/** Said to begin building ("yes", "go ahead", "start building", "build it now"). */
export const START_BUILDING = /^(?:ok(?:ay)?[,! ]*)?(?:yes|yeah|yep|sure|go|go ahead|proceed|start|start (?:the )?build(?:ing)?|build(?: it)?(?: now)?|begin|looks good|perfect|do it|let'?s go|that'?s (?:it|right|good))(?:[,.! ]+(?:please|now|thanks|thank you))*[.!]*$/i;
