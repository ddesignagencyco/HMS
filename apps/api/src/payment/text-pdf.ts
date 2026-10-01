// apps/api/src/payment/text-pdf.ts

const escapePdf = (text: string): string => text.replace(/[^\x20-\x7e]/g, '?').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** A dependency-free multi-page text PDF (built-in Helvetica), enough for statements: a title and lines of text, 50 lines to a page. */
export const renderTextPdf = (title: string, lines: readonly string[]): Buffer => {
  const perPage = 50;
  const pages: string[] = [];
  for (let start = 0; start < Math.max(lines.length, 1); start += perPage) {
    const rows: string[] = [];
    let y = 800;
    if (start === 0) {
      rows.push(`BT /F1 15 Tf 50 ${y} Td (${escapePdf(title)}) Tj ET`);
      y -= 28;
    }
    for (const line of lines.slice(start, start + perPage)) {
      rows.push(`BT /F1 10 Tf 50 ${y} Td (${escapePdf(line)}) Tj ET`);
      y -= 14;
    }
    pages.push(rows.join('\n'));
  }
  // Object layout: 1 catalog, 2 pages, 3 font, then a (page, content) pair per page.
  const objects: string[] = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids: number[] = [];
  pages.forEach((content, index) => {
    const pageObject = 4 + index * 2;
    kids.push(pageObject);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageObject + 1} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
  });
  objects[1] = `<< /Type /Pages /Kids [${kids.map(kid => `${kid} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let output = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(output, 'latin1'));
    output += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = Buffer.byteLength(output, 'latin1');
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(output, 'latin1');
};
