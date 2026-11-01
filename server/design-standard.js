// What every website the builder makes should have, so a one-line request
// still comes back looking like a professional, modern site: a rich hero,
// real photographs, tasteful motion, good backgrounds, video when the person
// has one. Shared by the single builder, the engineering team and the planner.

export const DESIGN_STANDARD = `DESIGN STANDARD (every website must look professional, modern and finished)
- Design tokens: define the brand colour, accent, dark and light surfaces, text colours, radius, shadow and spacing as CSS variables in :root and use them everywhere.
- Hero: the first section is full width with a rich background: a layered gradient (linear plus soft radial highlights), a subtle SVG pattern, or a photograph under a dark gradient overlay so the text stays readable (contrast at least 4.5:1). A big, confident headline, one short lead sentence, a primary and a secondary button.
- Sections: alternate backgrounds (light, tinted, dark), generous spacing with clamp(), a centred max-width container, grid or flex layouts that become one column on phones. Cards with rounded corners and soft shadows. Inline SVG icons for services and features.
- Typography: a clean system font stack (or the brand's), fluid sizes with clamp(), a clear hierarchy, comfortable line length.
- Motion: tasteful animation. Sections and cards fade and slide up as they scroll into view (an IntersectionObserver adds the class is-visible), buttons and cards lift slightly on hover and focus, smooth scrolling, optionally a slowly shifting gradient in the hero. Put all motion inside @media (prefers-reduced-motion: no-preference). Content must be visible without JavaScript: animation only enhances it, never hides it.
- Photographs make a site feel real. For each photo the page needs (hero, about, gallery, products, services), write
  <img src="images/descriptive-name.jpg" alt="what it shows" data-picture="a detailed description of the photograph to create: subject, setting, light, style" loading="lazy" width="1200" height="800" style="object-fit: cover">
  and give the image a background colour and aspect-ratio in CSS. The app creates these photographs after the files are written (at most six per build), so use clear, specific descriptions with no words or logos in them. Always use the person's own pictures (files they added) first. Logos and icons are inline SVG.
- Video: use a video only when the person supplied it: a file they added (under files/) as <video autoplay muted loop playsinline poster="..."> for a background or section, or a YouTube or Vimeo link they gave, embedded from youtube-nocookie.com/embed/ID (or player.vimeo.com) in a responsive 16:9 frame with a title. Never invent a video, picture or file URL.
- Footer: contact details, navigation and the year. A favicon as an inline SVG data URL.`;
