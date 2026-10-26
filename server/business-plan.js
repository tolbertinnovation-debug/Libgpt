import { BUSINESS_PLAN_DEFAULT_PAGES } from '../public/document-length.js';
// A complete business plan from one prompt.
//
// The guided business-plan task asks questions first, which is right for some
// people and a wall for most: somebody who types "a business plan for my
// bakery in Paynesville" wants a business plan, not a questionnaire. This mode
// writes the whole thing straight away.
//
// "Whole" is decided here, not by the model. A business plan has a known
// shape, so the sections are a fixed blueprint, written a few at a time, and
// the server checks which headings actually exist after each batch. The plan
// is finished when every section is there — not when a page count is reached
// by padding, and not when the model says it is done.
//
// The numbers are the hard part. A plan without figures is not complete, but
// figures nobody gave cannot be presented as facts. So projections are built
// from an explicit assumptions table, every derived number is calculated from
// it, and all of it is labelled as an illustrative estimate to replace with
// verified figures. Market evidence and competitors are never invented.

export { BUSINESS_PLAN_DEFAULT_PAGES };

export const BUSINESS_PLAN_SECTIONS = Object.freeze([
  { title: 'Executive Summary', batch: 1, match: /executive summary/i,
    brief: 'Business concept, the problem and solution, target customers, competitive advantage, mission, a Financial Highlights table (startup cost, year 1–3 revenue, net profit, break-even month) and the funding request with its purpose. Two to three pages; it must stand alone.' },
  { title: 'Company Description', batch: 1, match: /company (?:description|overview)|business description|about the (?:company|business)/i,
    brief: 'Mission, vision and values; legal structure and ownership (labelled placeholder if not given); location and why; stage of the business; short history or founding story only if supplied; key milestones to date.' },
  { title: 'Products and Services', batch: 1, match: /products?(?: and | & )services|our (?:products|services|offering)/i,
    brief: 'Each product or service, the customer problem it solves, features and benefits, a pricing table with unit prices and unit costs/margins, how quality is assured, and future products.' },
  { title: 'Industry and Market Analysis', batch: 2, match: /market analysis|industry (?:and|&) market|market research/i,
    brief: 'Industry overview and trends described qualitatively (no invented statistics); target market segments; two or three customer personas; a bottom-up market-size estimate (customers × purchase frequency × price) shown as a calculation table with every input labelled as an assumption to verify.' },
  { title: 'Competitive Analysis', batch: 2, match: /competit/i,
    brief: 'Competitors named by the user, otherwise competitor types (e.g. informal market sellers, established shops, imports). A comparison table on price, quality, location, service and convenience; positioning; sustainable competitive advantages and barriers to entry.' },
  { title: 'SWOT Analysis', batch: 2, match: /swot/i,
    brief: 'A two-column SWOT table (Strengths/Weaknesses, Opportunities/Threats) specific to this business, then how strengths will exploit opportunities and how weaknesses and threats will be managed.' },
  { title: 'Marketing and Sales Strategy', batch: 3, match: /marketing/i,
    brief: 'Brand positioning and message; the marketing mix (product, price, place, promotion); channels suited to the location (e.g. word of mouth, radio, WhatsApp, social media, community events); sales process; customer retention; a launch plan; a 12-month marketing budget table.' },
  { title: 'Operations Plan', batch: 3, match: /operations?(?: plan| and management)?$/i,
    brief: 'Premises and equipment; suppliers and inventory; a process diagram of how the product or service is delivered; opening hours and daily routine; technology and record keeping; quality and health/safety standards; capacity.' },
  { title: 'Management and Organisation', batch: 4, match: /management|organi[sz]ation|team/i,
    brief: 'An organisation chart diagram; owner and key roles with responsibilities (supplied names only; otherwise role titles); a staffing plan table with headcount and monthly wages by year; advisors or mentors to recruit.' },
  { title: 'Legal and Regulatory Requirements', batch: 4, match: /legal|regulat|licen[cs]|compliance/i,
    brief: 'Business registration, licences and permits, tax obligations, employment rules, insurance and any sector-specific rules for the stated country — described generally and marked to confirm with the relevant authority. No invented fees or law numbers.' },
  { title: 'Implementation Plan and Milestones', batch: 4, match: /implementation|milestone|roadmap|timeline/i,
    brief: 'A milestone table (milestone, target month, owner, success measure) from preparation through the first 24 months, and the key performance indicators to track monthly.' },
  { title: 'Risk Analysis and Mitigation', batch: 4, match: /risk/i,
    brief: 'A risk table (risk, likelihood, impact, mitigation, contingency) covering market, operational, financial, supply, regulatory, staffing and external risks such as currency movement or power supply.' },
  { title: 'Financial Plan', batch: 5, match: /financial plan|financial assumptions|startup costs/i,
    brief: 'In this order: Key Assumptions table (prices, volumes, growth, costs, wages, rent, loan terms); Startup Costs table with a total row; Sources and Use of Funds table and a pie chart of the use of funds; a 12-month revenue and expense forecast table for year 1 with totals.' },
  { title: 'Financial Projections', batch: 6, match: /financial projections?|projected financ|income statement/i,
    brief: 'In this order: 3-year projected income statement table; 3-year cash-flow projection table (opening cash, inflows, outflows, closing cash); break-even analysis with the calculation shown; a bar chart of revenue, total expenses and net profit for years 1–3; base/conservative/optimistic scenario table; a short commentary on profitability, cash needs and financial health.' },
  { title: 'Funding Request', batch: 7, match: /funding|investment|financing/i,
    brief: 'Amount requested, type (loan, grant, investment or owner savings, as supplied or as options), detailed use of funds consistent with the Financial Plan and Financial Projections, repayment schedule or investor return if relevant, and what security or commitment the owner brings.' },
  { title: 'Social and Economic Impact', batch: 7, match: /impact|community|social/i,
    brief: 'Jobs created, local suppliers supported, community benefit, inclusion of women and youth where relevant, and environmental practices — specific and modest, never exaggerated.' },
  { title: 'Appendices', batch: 7, match: /appendi|annex/i,
    brief: 'A checklist of supporting documents to attach (IDs, registration certificate, quotations, lease, CVs, bank statements), the full list of assumptions to verify, and a short glossary of business terms used.' },
]);

const headingsOf = (spec) => (spec?.blocks || []).filter((b) => b.type === 'heading' && b.level === 1).map((b) => b.text);

/** The blueprint sections whose heading does not exist yet, in order. */
export function remainingPlanSections(spec) {
  const headings = headingsOf(spec);
  return BUSINESS_PLAN_SECTIONS.filter((section) => !headings.some((heading) => section.match.test(heading)));
}

/** What to write in this request: the remaining sections of the earliest unfinished batch. */
export function nextPlanBatch(spec) {
  const remaining = remainingPlanSections(spec);
  if (!remaining.length) return [];
  return remaining.filter((section) => section.batch === remaining[0].batch);
}

export const BUSINESS_PLAN_PROMPT = `
COMPLETE BUSINESS PLAN MODE: The user wants a complete, professional, investor- and lender-ready business plan from a single request. Do not ask questions unless the request does not say what the business is at all; in that case ask only "What business is this plan for, and where will it operate?". Otherwise make sensible, clearly stated choices and write.
The full plan has these sections, each a level-1 heading with EXACTLY this text: ${BUSINESS_PLAN_SECTIONS.map((s) => s.title).join('; ')}. Use level-2 headings for subsections. Write only the sections assigned to this request, completely and in depth, with real analysis specific to this business, location and customers — never generic filler or descriptions of what a section should contain.
TRUTHFULNESS: Use every fact the user supplied exactly. Never invent market statistics, survey results, named competitors' figures, quotes, awards, partnerships, registrations or sources; describe the industry qualitatively and mark any figure that should be checked. Use labelled placeholders such as [Owner name] for personal details not supplied.
FINANCIALS: A one-prompt complete plan is an explicit request for financial projections. Base them on supplied figures; where figures are missing, choose realistic, conservative assumptions for the stated location and state each one in the Key Assumptions table. Every derived figure must be calculated from those assumptions and be internally consistent across all sections and tables (revenue = volume × price; totals add up; the Executive Summary highlights match the Financial Plan). Caption every financial table and chart "Illustrative projection based on the stated assumptions — replace with your verified figures." Use the currency the user gives; otherwise the local currency of the stated country alongside USD where helpful, defaulting to USD. Use table "footer" rows for totals and right-align numeric columns.
FIGURES: Include the charts, diagrams and tables named in each section brief. Every chart value must come from the plan's own tables.
Put items the owner must verify or supply in "missing" (short phrases, at most 20).`;

/** The instruction for one request, naming exactly which sections to write now. */
export function businessPlanBatchPrompt(spec) {
  const batch = nextPlanBatch(spec);
  if (!batch.length) {
    return '\nAll blueprint sections are written, but the user asked for more pages. Add substantive annexes that deepen the plan — for example a month-by-month cash-flow table, a marketing calendar, standard operating procedures or a supplier comparison — as level-1 headings beginning "Annex". Never repeat earlier content or pad.';
  }
  return `\nWRITE NOW — these sections only, in this order:\n${batch.map((s) => `- ${s.title}: ${s.brief}`).join('\n')}\n${spec ? 'Earlier sections are already written; keep their facts, names and numbers exactly consistent.' : 'Start with these sections; do not add a contents list (the application adds one).'}`;
}

/** Earlier text the next batch must stay consistent with: the summary and every table. */
export function businessPlanContext(spec, room = 24_000) {
  const keep = [];
  let used = 0;
  let inSummary = false;
  for (const block of spec?.blocks || []) {
    if (block.type === 'heading' && block.level === 1) inSummary = /executive summary/i.test(block.text);
    const wanted = inSummary || block.type === 'table' || block.type === 'heading';
    if (!wanted) continue;
    const size = JSON.stringify(block).length;
    if (used + size > room) break;
    used += size;
    keep.push(block);
  }
  return keep;
}

/** A contents list, inserted once at the front of a new plan. */
export function contentsBlocks() {
  return [
    { type: 'heading', level: 1, text: 'Contents' },
    { type: 'bullets', items: BUSINESS_PLAN_SECTIONS.map((s, i) => `${i + 1}. ${s.title}`) },
    { type: 'pageBreak' },
  ];
}
