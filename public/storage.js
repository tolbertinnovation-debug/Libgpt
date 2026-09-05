// Conversations live in localStorage. Nothing is sent anywhere except the
// messages themselves, on their way to the model — which matters for a
// platform whose users may be discussing their farm, their business or their
// health on a shared phone.

const KEY = 'grandpa-ai:chats:v1';
const PREFS = 'grandpa-ai:prefs:v1';
const MAX_CHATS = 100;

const read = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Quota full, or storage blocked (private window). The app keeps working
    // in memory for this session; only persistence is lost.
    return false;
  }
};

export const newId = () =>
  (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function loadChats() {
  const chats = read(KEY, []);
  return Array.isArray(chats) ? chats : [];
}

export function saveChats(chats) {
  // Newest first, and capped — an old phone should not fill its storage with
  // chat history.
  const trimmed = [...chats]
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, MAX_CHATS);
  return write(KEY, trimmed);
}

export function loadPrefs() {
  return read(PREFS, {});
}

export function savePrefs(prefs) {
  return write(PREFS, prefs);
}

export function groupByDate(chats) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000;
  const startOfWeek = startOfToday - 7 * 86_400_000;
  const startOfMonth = startOfToday - 30 * 86_400_000;

  const groups = [
    { label: 'Today', chats: [] },
    { label: 'Yesterday', chats: [] },
    { label: 'Previous 7 days', chats: [] },
    { label: 'Previous 30 days', chats: [] },
    { label: 'Older', chats: [] },
  ];

  for (const chat of chats) {
    const t = chat.updatedAt || 0;
    if (t >= startOfToday) groups[0].chats.push(chat);
    else if (t >= startOfYesterday) groups[1].chats.push(chat);
    else if (t >= startOfWeek) groups[2].chats.push(chat);
    else if (t >= startOfMonth) groups[3].chats.push(chat);
    else groups[4].chats.push(chat);
  }

  return groups.filter((g) => g.chats.length > 0);
}
