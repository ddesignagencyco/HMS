// apps/api/src/booking/invoice-pdf.ts
import { formatPaisa } from '@smart-home/domain';

export type InvoiceDocument = {
  number: string;
  issuedAt: Date;
  bookingCode: string;
  serviceName: string;
  customerName: string;
  providerName: string;
  lines: { description: string; amountPaisa: bigint }[];
  subtotalPaisa: bigint;
  surchargePaisa: bigint;
  discountPaisa: bigint;
  totalPaisa: bigint;
};

const escapePdf = (text: string): string =>
  // PDF strings are Latin-1 in this simple font; anything outside it becomes '?' rather than corrupting the file.
  text.replace(/[^\x20-\x7e]/g, '?').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/**
 * A small, dependency-free single-page PDF. An invoice is text and a few figures, so a hand-written
 * page with the built-in Helvetica font is enough, and it keeps document generation off the
 * critical path of adding a library. Every amount is formatted from integer paisa.
 */
export const renderInvoicePdf = (invoice: InvoiceDocument): Buffer => {
  const commands: string[] = [];
  const text = (value: string, size = 11, x = 50, y = 700, r = 0.15, g = 0.2, b = 0.3): void => {
    commands.push(`${r} ${g} ${b} rg BT /F1 ${size} Tf ${x} ${y} Td (${escapePdf(value)}) Tj ET`);
  };
  const money = (value: bigint): string => `PKR ${formatPaisa(value)}`;

  // Header background banner (Royal Blue)
  commands.push('0.06 0.28 0.58 rg 0 740 595 102 re f');
  // Decorative accent line
  commands.push('0.15 0.45 0.85 rg 0 735 595 5 re f');

  // Header text
  text('INVOICE', 22, 45, 792, 1, 1, 1);
  text(`NO: ${invoice.number}`, 12, 420, 792, 1, 1, 1);
  text('Smart Home Maintenance Services', 10, 45, 768, 0.85, 0.92, 1);
  text(`Booking: ${invoice.bookingCode}`, 10, 420, 768, 0.85, 0.92, 1);

  // Metadata Card (Bill To / Provider / Date)
  commands.push('0.96 0.97 0.99 rg 40 642 515 78 re f');
  commands.push('0.85 0.88 0.93 RG 0.75 w 40 642 515 78 re s');

  text('BILL TO:', 8, 55, 702, 0.4, 0.45, 0.55);
  text(invoice.customerName, 11, 55, 686, 0.1, 0.15, 0.25);
  text(`Date: ${invoice.issuedAt.toISOString().slice(0, 10)}`, 9, 55, 668, 0.4, 0.45, 0.55);

  text('FROM / PROVIDER:', 8, 280, 702, 0.4, 0.45, 0.55);
  text(invoice.providerName, 11, 280, 686, 0.1, 0.15, 0.25);
  text(`Service: ${invoice.serviceName}`, 9, 280, 668, 0.4, 0.45, 0.55);

  // PAID Badge
  commands.push('0.08 0.65 0.32 rg 455 664 85 24 re f');
  text('PAID', 11, 483, 672, 1, 1, 1);

  // Items Table Header
  let y = 600;
  commands.push(`0.08 0.28 0.58 rg 40 ${y} 515 24 re f`);
  text('DESCRIPTION', 9, 55, y + 7, 1, 1, 1);
  text('AMOUNT', 9, 460, y + 7, 1, 1, 1);
  y -= 22;

  // Table Rows
  let rowIndex = 0;
  for (const line of invoice.lines) {
    if (rowIndex % 2 === 1) {
      commands.push(`0.97 0.98 0.99 rg 40 ${y - 4} 515 22 re f`);
    }
    commands.push(`0.9 0.92 0.95 RG 0.5 w 40 ${y - 4} 515 0.5 re s`);
    text(line.description, 10, 55, y + 3, 0.15, 0.2, 0.3);
    text(money(line.amountPaisa), 10, 460, y + 3, 0.15, 0.2, 0.3);
    y -= 22;
    rowIndex++;
  }

  // Summary box
  y -= 10;
  commands.push(`0.9 0.92 0.95 RG 0.75 w 330 ${y - 65} 225 75 re s`);
  commands.push(`0.98 0.99 1 rg 330 ${y - 65} 225 75 re f`);

  text(`Subtotal: ${money(invoice.subtotalPaisa)}`, 10, 345, y - 8, 0.3, 0.35, 0.45);
  if (invoice.surchargePaisa > 0n) {
    text(`Surcharge: ${money(invoice.surchargePaisa)}`, 10, 345, y - 24, 0.3, 0.35, 0.45);
  }
  if (invoice.discountPaisa > 0n) {
    text(`Discount: -${money(invoice.discountPaisa)}`, 10, 345, y - 40, 0.1, 0.55, 0.25);
  }

  // Total banner box
  commands.push(`0.06 0.28 0.58 rg 330 ${y - 65} 225 24 re f`);
  text(`TOTAL: ${money(invoice.totalPaisa)}`, 11, 345, y - 57, 1, 1, 1);

  // Thank you footer
  text('Thank You!', 16, 245, 110, 0.08, 0.28, 0.58);
  text('Smart Home Maintenance Services · Automated Digital Escrow Receipt', 8, 140, 90, 0.5, 0.55, 0.6);

  const stream = commands.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`
  ];
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
