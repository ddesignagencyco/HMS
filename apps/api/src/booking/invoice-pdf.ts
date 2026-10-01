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
  const rows: string[] = [];
  let y = 790;
  const text = (value: string, size = 11, x = 50): void => {
    rows.push(`BT /F1 ${size} Tf ${x} ${y} Td (${escapePdf(value)}) Tj ET`);
    y -= size + 6;
  };
  const money = (value: bigint): string => `PKR ${formatPaisa(value)}`;

  text('Smart Home Maintenance Services', 16);
  text(`Invoice ${invoice.number}`, 13);
  text(`Issued: ${invoice.issuedAt.toISOString().slice(0, 10)}   Booking: ${invoice.bookingCode}`);
  y -= 8;
  text(`Customer: ${invoice.customerName}`);
  text(`Provider: ${invoice.providerName}`);
  text(`Service: ${invoice.serviceName}`);
  y -= 12;
  text('Items', 12);
  for (const line of invoice.lines) {
    text(`${line.description}`, 11, 60);
    y += 17;
    text(money(line.amountPaisa), 11, 430);
  }
  y -= 10;
  text(`Subtotal: ${money(invoice.subtotalPaisa)}`, 11, 330);
  if (invoice.surchargePaisa > 0n) text(`Surcharge: ${money(invoice.surchargePaisa)}`, 11, 330);
  if (invoice.discountPaisa > 0n) text(`Discount: -${money(invoice.discountPaisa)}`, 11, 330);
  text(`Total: ${money(invoice.totalPaisa)}`, 13, 330);

  const stream = rows.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
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
