export const HISTORY_PHASES = {
  origins: 'Origins and background', development: 'Growth and major events',
  later: 'Later developments and turning points', outcome: 'Outcome, decline or current position',
  legacy: 'Legacy and significance',
};

export function readHistoryAccount(value) {
  const filled = (s, min, max) => typeof s === 'string' && s.trim().length >= min && s.length <= max;
  if (!value || !filled(value.scope, 1, 600)) throw Error('The historical account needs its topic and period.');
  const source = Array.isArray(value.sections) ? value.sections
    : value.sections && typeof value.sections === 'object'
      ? Object.entries(value.sections).map(([id, section]) => ({
        ...(section && typeof section === 'object' && !Array.isArray(section) ? section : { paragraphs: section }), id,
      })) : [];
  if (source.length !== 5) throw Error('The historical account is missing its full chronology.');
  const phaseId = section => Object.keys(HISTORY_PHASES).find(id =>
    [id, HISTORY_PHASES[id]].some(name => name.toLowerCase() === String(section?.id || section?.title || '').trim().toLowerCase()));
  const sections = Object.keys(HISTORY_PHASES).map(id => {
    const matches = source.filter(s => phaseId(s) === id), s = matches[0];
    const paragraphs = typeof s?.paragraphs === 'string'
      ? s.paragraphs.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean) : s?.paragraphs;
    if (matches.length !== 1 || !Array.isArray(paragraphs) || !paragraphs.length || paragraphs.length > 6
      || paragraphs.some(p => !filled(p, 20, 6000))) throw Error('The historical account is missing ' + HISTORY_PHASES[id] + '.');
    return { id, title: HISTORY_PHASES[id], paragraphs: paragraphs.map(p => p.trim()) };
  });
  const opening = sections.flatMap(s => s.paragraphs);
  // A complete account can use fewer, longer paragraphs. Brief placeholder phases still fail.
  if ((opening.length < 8 && opening.join(' ').length < 900) || JSON.stringify(sections).length > 80000)
    throw Error('The historical account needs a developed beginning, middle and outcome.');
  const metadata = key => typeof value[key] === 'string' ? value[key].trim() : '';
  return {
    ...value, scope: value.scope.trim(), sections, opening, historyComplete: true,
    summary: metadata('summary') || metadata('title'),
    takeaway: metadata('takeaway') || sections.at(-1).paragraphs.at(-1), note: metadata('note'),
  };
}

export function historyBodyParts(value) {
  return value.historyComplete && Array.isArray(value.sections)
    ? ['Scope: ' + value.scope, ...value.sections.flatMap(s => [HISTORY_PHASES[s.id] || s.title, ...s.paragraphs])]
    : value.opening || [];
}
