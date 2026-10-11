// Text is read locally; PDFs travel as files so scanned pages, tables,
// and diagrams are available to the vision model as well as their text.
export const MOST_TEXT = 50_000;
export const PAPER_TYPES = '.txt,.md,.csv,.tsv,.log,.json,.yaml,.yml,.pdf,text/plain,application/pdf';
const PLAIN = /\.(txt|md|markdown|csv|tsv|log|json|ya?ml)$/i;

export async function readPaper(file) {
  if (!file) throw new Error('No document was chosen.');
  const name = (file.name || 'document').slice(0, 60);
  if (/\.pdf$/i.test(name) || file.type === 'application/pdf') {
    if (file.size > 900_000) throw new Error('Choose a PDF smaller than 900 KB, or split it into smaller files.');
    const header = new TextDecoder().decode(await file.slice(0, 5).arrayBuffer());
    if (header !== '%PDF-') throw new Error('That file is not a readable PDF.');
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('That PDF could not be opened.'));
      reader.readAsDataURL(new Blob([file], { type: 'application/pdf' }));
    });
    return { name, data, bytes: file.size, text: '', words: 0, clipped: false };
  }
  if (!PLAIN.test(name) && !/^text\//.test(file.type || '')) {
    throw new Error('Choose a PDF or a text file, or attach a photo of the page.');
  }
  if (file.size > 2_000_000) throw new Error('Choose a text file smaller than 2 MB.');
  let text = (await file.text()).trim();
  if (!text) throw new Error('That file is empty.');
  const clipped = text.length > MOST_TEXT;
  if (clipped) text = `${text.slice(0, MOST_TEXT)}…`;
  return { name, text, words: (text.match(/\S+/g) || []).length, clipped };
}
