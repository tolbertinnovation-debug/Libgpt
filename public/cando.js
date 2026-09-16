// What Grandpa can actually do, under the composer.
//
// That space used to carry a warning. A warning is worth saying once, and it
// is already said where it matters — the assistant is told in every
// conversation not to give a diagnosis, a legal ruling or a financial
// guarantee, and to name the teacher, nurse or extension officer to ask
// instead. Repeating it under the box a person types into told them nothing
// except to be careful, forever.
//
// So the space says what this is for instead. Most people who open it have no
// idea it will tell them a folktale, work through their homework, or read the
// answer out loud in an elder's voice — and a line that quietly shows them one
// of those is worth more than a line that warns them about all of it.
//
// No line says "he". Grandpa is the name on the door, but the elder talking
// may be Grandma, the Market Auntie or the Coastal Sage — so the chrome around
// the conversation does not assume, and speaks to the reader instead.
//
// Each line is a real feature. Where one depends on the deployment — pictures
// are off unless switched on, live news needs a key that can read the web —
// it says what it needs, and it is simply not shown when that is missing.
// Promising something the app cannot do would be its own kind of lie.

export const CAN_DO = [
  { text: 'Ask for a folktale — you choose how it ends.' },
  { text: 'Ask for a child\'s name, and what that name carries.' },
  { text: 'Palava sauce, dumboy, pepper soup — with the story behind them.' },
  { text: 'Homework: see the method worked through, then try one yourself.' },
  { text: 'Business: pricing, bookkeeping, what a loan officer looks for.' },
  { text: 'Farming: sick cassava, planting time, keeping a harvest dry.' },
  { text: 'Liberian English, with the words explained if you need them.' },
  { text: 'Ask what a proverb really means, not just what it says.' },

  { text: 'Tap Listen and any answer is read out loud.', needs: 'voice' },
  { text: 'Hold the microphone and just talk — the answer comes back out loud.', needs: 'voice' },
  { text: 'Ask what is in the news today, and it is looked up just now.', needs: 'liveNews' },
  { text: 'Ask for a painted scene of Liberian life.', needs: 'images' },
];

/**
 * The lines this deployment can honestly show.
 *
 * `have` names what is switched on — { voice, liveNews, images }. Anything a
 * line needs and this one does not have is left out rather than shown and
 * disappointed.
 */
export function canDoFor(have = {}) {
  return CAN_DO.filter((line) => !line.needs || have[line.needs]).map((line) => line.text);
}

/**
 * Walk the list in a shuffled order rather than a fixed one.
 *
 * Shuffled so two people on two phones do not see the same thing in the same
 * sequence, but walked rather than re-rolled each time, so the same line does
 * not come up twice in a row and every one of them gets its turn.
 */
export function canDoOrder(lines) {
  const order = [...lines];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}
