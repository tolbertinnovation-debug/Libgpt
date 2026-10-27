// Opt-in resource restrictions, not complete network or renderer isolation.
export const RESTRICTED_PREVIEW_CSP = "default-src 'none'; script-src 'unsafe-inline' data: blob:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'";
export function restrictPreviewDocument(html) {
  // A prefix is essential: project markup can put scripts before its <head>.
  return '<!doctype html><meta http-equiv="Content-Security-Policy" content="'+RESTRICTED_PREVIEW_CSP+'"><meta name="referrer" content="no-referrer">'+html.replace(/^\s*<!doctype[^>]*>/i,'');
}
