export const DOCUMENT_TASKS = {
  business_plan: { label: 'Complete business plan', template: 'report', required: ['business', 'offering', 'audience', 'location', 'purpose', 'finances'] },
  project_proposal: { label: 'Project proposal', template: 'proposal', required: ['organisation', 'project', 'problem', 'audience', 'location', 'timeline', 'budget', 'recipient'] },
  letter: { label: 'Letter', template: 'letter', required: ['sender', 'recipient', 'purpose', 'details'] },
  graphic_design: { label: 'Graphic design', template: 'poster', required: ['format', 'audience', 'headline', 'details', 'branding', 'dimensions'] },
  resume: { label: 'CV or resume', template: 'resume', required: ['sender', 'purpose', 'experience', 'education', 'skills'] },
  invoice: { label: 'Invoice or receipt', template: 'invoice', required: ['sender', 'recipient', 'details', 'budget', 'payment'] },
  handbook: { label: 'Handbook or learning material', template: 'handbook', required: ['purpose', 'audience', 'details', 'scope'] },
  report: { label: 'Report', template: 'report', required: ['purpose', 'audience', 'details', 'scope'] },
  general: { label: 'Other document', template: 'report', required: ['purpose', 'audience', 'details'] },
};
export const TASK_FIELDS = {
  business: ['Business name and stage', 'What is the business name, and is it new or already operating?'],
  offering: ['Products or services', 'What products or services will the business offer?'],
  audience: ['Audience or beneficiaries', 'Who is this for: customers, readers, beneficiaries or another audience?'],
  location: ['Location', 'Where will the business or project operate?'],
  purpose: ['Purpose', 'What should this document or design achieve, and who will use it?'],
  finances: ['Financial information', 'What prices, costs, available funds and funding needs should I use? If these are unknown, should I use labelled placeholders or an explicitly illustrative scenario?'],
  organisation: ['Organisation', 'Which organisation or person is responsible for this project?'],
  project: ['Project', 'What is the project name and what will it do?'],
  problem: ['Problem to address', 'What problem does the project address, and what evidence or background can you provide?'],
  timeline: ['Timeline', 'When should the project start, how long will it last, and are there important milestones?'],
  budget: ['Budget and currency', 'What budget, amounts, quantities and currency should I use? If unknown, tell me how you want missing figures handled.'],
  recipient: ['Recipient', 'Who should receive this document? Please give the name, role or organisation and any required address.'],
  sender: ['Sender or author', 'Whose name and contact details should appear as the sender or author?'],
  details: ['Content and facts', 'What key facts, points, wording, items or source materials must be included?'],
  format: ['Design format', 'What should I design: a flyer, poster, invitation, brochure, logo concept or another format?'],
  headline: ['Headline or brand name', 'What headline, brand name or main message should the design display?'],
  branding: ['Branding', 'Which colours, visual style and branding should I use? You can also ask me to propose a style.'],
  designStyle: ['Design style', 'Which design style do you prefer?'],
  dimensions: ['Size and use', 'Where will the design be used, and what size or orientation is needed: social media, A4 print, square, portrait or landscape?'],
  experience: ['Experience', 'What real work experience, dates and achievements should the CV include?'],
  education: ['Education', 'What qualifications, institutions and dates should be included?'],
  skills: ['Skills', 'Which relevant skills and certifications can you confirm?'],
  payment: ['Payment status and details', 'Is this an unpaid invoice or a paid receipt, and what payment details and reference should appear?'],
  scope: ['Scope and sources', 'What topics, length, source materials and level of detail should this cover?'],
  length: ['Requested length', 'How many pages or how much detail should this document contain?'],
  tone: ['Tone and language', 'What tone and language do you prefer?'],
};

export function documentTaskKind(value) {
  const text = String(value || '');
  if (/business plan/i.test(text)) return 'business_plan';
  if (/\bproposal\b|project plan/i.test(text)) return 'project_proposal';
  if (/graphic design|flyer|poster|brochure|invitation|logo concept|letterhead|infographic/i.test(text)) return 'graphic_design';
  if (/\bletter\b|affidavit/i.test(text)) return 'letter';
  if (/\bcv\b|resume|résumé/i.test(text)) return 'resume';
  if (/invoice|receipt/i.test(text)) return 'invoice';
  if (/handbook|manual|lesson plan|syllabus/i.test(text)) return 'handbook';
  if (/report/i.test(text)) return 'report';
  return 'general';
}

export function readTaskBrief(value) {
  const fail = () => { throw Object.assign(new Error('The task details were invalid. Please describe the task again.'), { status: 400 }); };
  if (!value || !Object.hasOwn(DOCUMENT_TASKS, value.kind) || typeof value.summary !== 'string' || value.summary.length > 1200 || !value.fields || typeof value.fields !== 'object' || Array.isArray(value.fields)) fail();
  const fields = {};
  for (const [key, text] of Object.entries(value.fields)) {
    if (!Object.hasOwn(TASK_FIELDS, key) || typeof text !== 'string' || text.length > 3000) fail();
    if (text.trim()) fields[key] = text.trim();
  }
  if (JSON.stringify(fields).length > 30_000) fail();
  return { kind: value.kind, summary: value.summary.trim(), fields };
}

export function missingTaskFields(brief) {
  return DOCUMENT_TASKS[brief.kind].required.filter(key => !brief.fields[key] || /^(?:unknown|not (?:provided|specified)|n\/a|tbd|to be (?:provided|confirmed)|\[.*\])$/i.test(brief.fields[key]));
}

export function wantsTaskDraft(value) {
  return /^(?:please\s+)?(?:(?:create|draft|generate|make)\s+(?:(?:it|this task|this document)\s+)?now\b|go ahead\b|proceed\b|use (?:clearly |labelled |labeled )?placeholders\b)/i.test(String(value || '').trim());
}

export function startsNewDocumentTask(value) {
  return /^(?:please\s+)?(?:(?:create|write|draft|prepare|make|design|generate)(?:\s+(?:me|for me))?|i (?:need|want))\s+(?:(?:a|an|my|our|new|another)\s+)*(?:business plan|(?:project |funding |grant |business )?proposal|letter|cv|resume|résumé|invoice|receipt|handbook|manual|lesson plan|syllabus|report|graphic design|flyer|poster|brochure|invitation|logo(?: concept)?|letterhead|infographic|(?:pdf |word )?document)\b/i.test(String(value || '').trim());
}
