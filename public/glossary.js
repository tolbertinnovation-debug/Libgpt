// Liberian English terms, explained where they appear.
//
// Grandpa AI answers in Liberian English on purpose. A reader who is not
// Liberian — a partner, a funder, a student from another county — should be
// able to follow without the app translating the vernacular away.

export const GLOSSARY = {
  'small-small': 'A little at a time; gradually.',
  'fine-fine': 'Very well; nicely done.',
  'long-long time': 'Long ago; in the old days.',
  'done finish': 'Already completed.',
  'pikin': 'A child.',
  'pikin them': 'The children.',
  'my people': 'A warm address to those listening — friends, family, community.',
  'i beg you': 'Please — a polite request, not begging.',
  'na easy': 'Is not easy; is difficult.',
  'palava': 'A dispute or trouble; also a discussion to settle one.',
  'palava sauce': 'A Liberian dish of greens stewed with meat or fish and palm oil.',
  'palaver hut': 'The open meeting house where elders hear disputes and settle them by talking.',
  'dumboy': 'Pounded cassava, eaten with soup.',
  'fufu': 'Pounded cassava or plantain dough, eaten with soup.',
  'pepper soup': 'A hot, peppery broth with meat or fish.',
  'jollof': 'Rice cooked in a seasoned tomato base, common across West Africa.',
  'country cloth': 'Handwoven Liberian cloth, traditionally made in strips.',
  'susu': 'A rotating savings club — members contribute regularly and take turns collecting the pot.',
  'kwi': 'Westernised or town ways, as distinct from country ways.',
  'lappa': 'A length of cloth worn wrapped around the waist.',
  'cook shop': 'A small eating house selling prepared food.',
  'market woman': 'A woman who trades in the market — often the backbone of a household economy.',
  'ground pea': 'Groundnut; peanut.',
  'greens': 'Leafy vegetables such as potato greens or cassava leaf, cooked into a sauce.',
  'harmattan': 'The dry, dusty season wind that blows down from the Sahara.',
  'rainy season': 'Roughly May to October in Liberia, when most planting is done.',
  'dry season': 'Roughly November to April, when land is cleared and burned.',
  'upcountry': 'The interior, away from the coast.',
  'up-country': 'The interior, away from the coast.',
  'extension officer': 'A government agriculture adviser who works with farmers in the district.',
  'kpelle': 'Liberia’s largest ethnic group and its language, spoken mainly in the central region.',
  'bassa': 'A Liberian ethnic group and language, spoken mainly in the centre and along the coast.',
  'vai': 'A Liberian ethnic group and language, notable for its own indigenous script.',
  'kru': 'A Liberian coastal ethnic group, long known as seafarers and fishermen.',
  'ananse': 'The spider of West African folktales — clever, greedy, and usually caught out by his own scheming.',
  'cotton tree': 'The great silk-cotton tree; a landmark and a gathering place, treated with respect.',
};

// Longest first, so "palava sauce" is matched before "palava".
const TERMS = Object.keys(GLOSSARY).sort((a, b) => b.length - a.length);

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PATTERN = new RegExp(`\\b(${TERMS.map(escapeRegex).join('|')})\\b`, 'gi');

/**
 * Wrap known terms in the rendered HTML of one message.
 *
 * Works on the live DOM rather than the HTML string so it can never introduce
 * markup into text — it only ever splits existing text nodes. Code, links and
 * headings are skipped, and each term is annotated once per message so a long
 * answer is not covered in dotted underlines.
 */
export function annotateGlossary(root) {
  if (!root) return 0;

  const seen = new Set();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      // Leave code, links and existing terms alone.
      if (node.parentElement?.closest('code, pre, a, .glossary-term')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const targets = [];
  let node;
  while ((node = walker.nextNode())) targets.push(node);

  let count = 0;
  for (const text of targets) {
    PATTERN.lastIndex = 0;
    if (!PATTERN.test(text.nodeValue)) continue;
    PATTERN.lastIndex = 0;

    const fragment = document.createDocumentFragment();
    let last = 0;
    let match;

    while ((match = PATTERN.exec(text.nodeValue))) {
      const key = match[0].toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      fragment.append(text.nodeValue.slice(last, match.index));

      const mark = document.createElement('button');
      mark.type = 'button';
      mark.className = 'glossary-term';
      mark.textContent = match[0];
      mark.dataset.meaning = GLOSSARY[key] || '';
      mark.setAttribute('aria-label', `${match[0]}: ${mark.dataset.meaning}`);
      fragment.append(mark);

      last = match.index + match[0].length;
      count += 1;
    }

    if (last === 0) continue;
    fragment.append(text.nodeValue.slice(last));
    text.replaceWith(fragment);
  }

  return count;
}
