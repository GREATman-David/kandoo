import { Document, ExternalHyperlink, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';

/**
 * A Kandoo note as a real Word document (.docx), so a note, a research
 * write-up or a shared team note opens in Microsoft Word for editing. Kandoo
 * notes use a light plain-text structure; it maps onto Word's own styles:
 *   "Heading:" on its own line → Heading 2
 *   "• point"                  → a bulleted paragraph
 *   "References:" list         → numbered lines with clickable links
 */

const URL_PATTERN = /(https?:\/\/[^\s)\]]+)/g;

/** A line's text, with any URLs turned into hyperlinks. */
function runs(line: string): (TextRun | ExternalHyperlink)[] {
  const out: (TextRun | ExternalHyperlink)[] = [];
  let last = 0;
  for (const match of line.matchAll(URL_PATTERN)) {
    const url = match[0].replace(/[.,;:]+$/, '');
    const at = match.index ?? 0;
    if (at > last) out.push(new TextRun(line.slice(last, at)));
    out.push(new ExternalHyperlink({ link: url, children: [new TextRun({ text: url, style: 'Hyperlink' })] }));
    last = at + url.length;
  }
  if (last < line.length) out.push(new TextRun(line.slice(last)));
  return out;
}

export function noteParagraphs(body: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  for (const raw of body.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^[^•\n]{1,60}:$/.test(line)) {
      paragraphs.push(new Paragraph({ text: line.slice(0, -1), heading: HeadingLevel.HEADING_2 }));
    } else if (line.startsWith('• ')) {
      paragraphs.push(new Paragraph({ children: runs(line.slice(2)), bullet: { level: 0 } }));
    } else {
      paragraphs.push(new Paragraph({ children: runs(line), spacing: { after: 120 } }));
    }
  }
  return paragraphs;
}

export async function noteToDocx(input: { title: string; body: string; footer: string }): Promise<Buffer> {
  const doc = new Document({
    creator: 'Kandoo',
    title: input.title,
    sections: [
      {
        children: [
          new Paragraph({ text: input.title, heading: HeadingLevel.TITLE }),
          ...noteParagraphs(input.body),
          new Paragraph({
            spacing: { before: 400 },
            children: [new TextRun({ text: input.footer, italics: true, color: '7A6758', size: 18 })],
          }),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

/** A file name for the download: the title, made safe, as .docx. */
export function docxName(title: string): string {
  const base = title.replace(/[^\p{L}\p{N} _().-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${base || 'Kandoo note'}.docx`;
}
