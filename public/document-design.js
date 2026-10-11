export const DESIGN_STYLES = {
  modern_tech: { label: 'Modern technology', colors: ['10263D','00B7A8','EFF9FA'], guidance: 'Dark navy ground, teal highlights, a large asymmetric headline, geometric technology illustration, generous whitespace and a clear rounded call-to-action.' },
  bold_campaign: { label: 'Bold campaign', colors: ['B52935','142F4C','FFFFFF'], guidance: 'Red, navy and white colour blocking, oversized short sans-serif headline, purposeful diagonal geometry, strong hierarchy and a high-contrast action panel.' },
  elegant_editorial: { label: 'Elegant editorial', colors: ['26342D','C09A58','FCF8EF'], guidance: 'Cream ground, restrained forest green and gold, serif headline paired with sans-serif supporting text, thin rules, balanced margins and a calm premium composition.' },
  community_event: { label: 'Community event', colors: ['12665C','E79B43','FFF4DF'], guidance: 'Warm cream and deep green with amber accents, simple geometric cultural motifs, welcoming typography, prominent event details and a useful action panel.' },
  clean_corporate: { label: 'Clean corporate', colors: ['153A60','2B75A8','FFFFFF'], guidance: 'White background, blue accents, consistent alignment, concise information cards, fine dividers and a clear professional call-to-action.' },
  learning_promo: { label: 'Learning promotion', colors: ['552B75','D9B54A','F7F3FC'], guidance: 'Purple and warm gold, an original book/computer illustration built from shapes, a confident headline, clearly grouped learning benefits and a prominent registration action.' },
};

export const DESIGN_SIZES = {
  square: { label: 'Square post · 1080 × 1080', width: 1080, height: 1080 },
  portrait: { label: 'Portrait flyer · 1080 × 1350', width: 1080, height: 1350 },
  story: { label: 'Story · 1080 × 1920', width: 1080, height: 1920 },
  a4: { label: 'A4 print · 2480 × 3508', width: 2480, height: 3508 },
  landscape: { label: 'Landscape · 1920 × 1080', width: 1920, height: 1080 },
};

// Shared conservative wrapping keeps explicit line breaks and uses the same
// line count for validation, browser preview and every exporter.
export function drawingTextLines(value, width, size, tracking = 0) {
  const limit = Math.max(1, Math.floor(width / (size * .64 + tracking)));
  const lines = [];
  for (const paragraph of String(value).split('\n')) {
    let remaining = paragraph.trim();
    if (!remaining) { lines.push(''); continue; }
    while (remaining.length > limit) {
      const split = remaining.lastIndexOf(' ', limit);
      const at = split > 0 ? split : limit;
      lines.push(remaining.slice(0, at).trim()); remaining = remaining.slice(at).trimStart();
    }
    lines.push(remaining);
  }
  return lines;
}
