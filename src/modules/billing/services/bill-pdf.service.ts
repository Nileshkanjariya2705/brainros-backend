import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';

const MONTH_NAMES = [
  '',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export interface BillPdfData {
  billNumber: string;
  billDate: string | Date;
  financialYear?: string;
  billingMonth?: number | null;
  billingYear?: number | null;
  dueDate?: string | Date | null;
  schoolName: string;
  schoolCode: string;
  schoolEmail?: string | null;
  schoolPhone?: string | null;
  schoolAddress?: string | null;
  schoolCity?: string | null;
  schoolState?: string | null;
  schoolStateCode?: string | null;
  schoolGstin?: string | null;
  studentCount?: number;
  pricePerStudent?: number;
  description?: string | null;
  hsnSacCode?: string;
  amount: number;
  discount?: number;
  taxableValue?: number;
  isInterState?: boolean;
  cgstRate?: number;
  cgstAmount?: number;
  sgstRate?: number;
  sgstAmount?: number;
  igstRate?: number;
  igstAmount?: number;
  cessRate?: number;
  cessAmount?: number;
  tax: number;
  totalAmount: number;
  amountInWords?: string;
  reverseCharge?: boolean;
  supplierLegalName?: string;
  supplierTradeName?: string;
  supplierGstin?: string;
  supplierPan?: string;
  supplierState?: string;
  supplierStateCode?: string;
  supplierAddress?: string;
  supplierEmail?: string;
  supplierPhone?: string;
  bankName?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
  bankBranch?: string;
  status: string;
  createdByName?: string | null;
  approvedByName?: string | null;
  approvedAt?: string | Date | null;
}

export function convertNumberToIndianWords(amount: number): string {
  if (isNaN(amount) || amount === 0) return 'Rupees Zero Only';

  const single = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const teen = [
    'Ten',
    'Eleven',
    'Twelve',
    'Thirteen',
    'Fourteen',
    'Fifteen',
    'Sixteen',
    'Seventeen',
    'Eighteen',
    'Nineteen',
  ];
  const tens = [
    '',
    '',
    'Twenty',
    'Thirty',
    'Forty',
    'Fifty',
    'Sixty',
    'Seventy',
    'Eighty',
    'Ninety',
  ];

  function convertTwoDigits(num: number): string {
    if (num === 0) return '';
    if (num < 10) return single[num];
    if (num < 20) return teen[num - 10];
    const unit = num % 10;
    return `${tens[Math.floor(num / 10)]}${unit ? ' ' + single[unit] : ''}`;
  }

  function convertThreeDigits(num: number): string {
    const hundred = Math.floor(num / 100);
    const remainder = num % 100;
    let res = '';
    if (hundred > 0) res += `${single[hundred]} Hundred`;
    if (remainder > 0) {
      res += (res ? ' ' : '') + convertTwoDigits(remainder);
    }
    return res;
  }

  const intVal = Math.floor(Math.abs(amount));
  const decimalVal = Math.round((Math.abs(amount) - intVal) * 100);

  let num = intVal;
  let words = '';

  const crore = Math.floor(num / 10000000);
  num %= 10000000;
  const lakh = Math.floor(num / 100000);
  num %= 100000;
  const thousand = Math.floor(num / 1000);
  num %= 1000;
  const remainder = num;

  if (crore > 0) words += `${convertTwoDigits(crore)} Crore `;
  if (lakh > 0) words += `${convertTwoDigits(lakh)} Lakh `;
  if (thousand > 0) words += `${convertTwoDigits(thousand)} Thousand `;
  if (remainder > 0) words += `${convertThreeDigits(remainder)} `;

  words = words.trim() || 'Zero';

  let result = `Rupees ${words}`;
  if (decimalVal > 0) {
    result += ` and ${convertTwoDigits(decimalVal)} Paise`;
  }
  result += ' Only';
  return result;
}

@Injectable()
export class BillPdfService {
  private readonly logger = new Logger(BillPdfService.name);

  /**
   * Generates a fully Indian GST-compliant Tax Invoice PDF.
   */
  async generateBillPdf(data: BillPdfData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margin: 36,
          info: {
            Title: `GST Tax Invoice - ${data.billNumber}`,
            Author: data.supplierLegalName || 'Brainros Educational Technologies Pvt. Ltd.',
          },
        });

        const buffers: Buffer[] = [];
        doc.on('data', (chunk) => buffers.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', (err) => reject(err));

        const formattedDate = new Date(data.billDate).toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        });

        const billingPeriodStr =
          data.billingMonth && data.billingYear
            ? `${MONTH_NAMES[data.billingMonth] || 'Month ' + data.billingMonth} ${data.billingYear}`
            : 'Custom Period';

        const studentCount = data.studentCount ?? 0;
        const pricePerStudent = data.pricePerStudent ?? 300;
        const hsnSacCode = data.hsnSacCode || '999293';
        const taxableVal = data.taxableValue ?? data.amount;
        const amountWords = data.amountInWords || convertNumberToIndianWords(data.totalAmount);

        const supplierName = data.supplierLegalName || 'Brainros Educational Technologies Pvt. Ltd.';
        const supplierGstin = data.supplierGstin || '29AABCB1234F1Z5';
        const supplierPan = data.supplierPan || 'AABCB1234F';
        const supplierState = data.supplierState || 'Karnataka';
        const supplierStateCode = data.supplierStateCode || '29';
        const supplierAddress = data.supplierAddress || 'Tech Park, Outer Ring Road, Bangalore - 560103, Karnataka';

        // ── 1. HEADER & BRANDING ──────────────────────────────────
        doc.rect(36, 36, 523, 70).fill('#0f172a');

        doc.fillColor('#ffffff')
          .fontSize(22)
          .font('Helvetica-Bold')
          .text(data.supplierTradeName || 'BRAINROS', 50, 48);

        doc.fillColor('#94a3b8')
          .fontSize(8.5)
          .font('Helvetica')
          .text(supplierName, 50, 74)
          .text(`GSTIN: ${supplierGstin}  |  PAN: ${supplierPan}  |  State: ${supplierState} (${supplierStateCode})`, 50, 86);

        doc.fillColor('#38bdf8')
          .fontSize(16)
          .font('Helvetica-Bold')
          .text('TAX INVOICE', 350, 48, { align: 'right', width: 195 });

        doc.fillColor('#cbd5e1')
          .fontSize(9)
          .font('Helvetica')
          .text(`Invoice No: ${data.billNumber}`, 350, 72, { align: 'right', width: 195 })
          .text(`Date: ${formattedDate}`, 350, 85, { align: 'right', width: 195 });

        // ── 2. METADATA CARDS ─────────────────────────────────────
        let y = 118;

        // Left Box: Recipient / Billed To
        doc.rect(36, y, 255, 115).fill('#f8fafc').stroke('#cbd5e1');
        doc.fillColor('#1e293b').fontSize(9).font('Helvetica-Bold').text('BILLED TO (RECIPIENT):', 46, y + 8);
        doc.fillColor('#0f172a').fontSize(11).font('Helvetica-Bold').text(data.schoolName, 46, y + 22, { width: 235 });
        doc.fillColor('#475569').fontSize(8.5).font('Helvetica');
        doc.text(`Institution Code: ${data.schoolCode}`, 46, y + 48);
        doc.text(`GSTIN: ${data.schoolGstin || 'Unregistered / Exempt'}`, 46, y + 60);
        doc.text(`State: ${data.schoolState || 'Karnataka'} (Code: ${data.schoolStateCode || '29'})`, 46, y + 72);
        doc.text(`Place of Supply: ${data.schoolState || 'Karnataka'}`, 46, y + 84);
        if (data.schoolAddress || data.schoolCity) {
          doc.text(`Address: ${[data.schoolAddress, data.schoolCity].filter(Boolean).join(', ')}`, 46, y + 96, { width: 235, ellipsis: true });
        }

        // Right Box: Invoice Particulars & Supplier Address
        doc.rect(304, y, 255, 115).fill('#f8fafc').stroke('#cbd5e1');
        doc.fillColor('#1e293b').fontSize(9).font('Helvetica-Bold').text('SUPPLY & INVOICE DETAILS:', 314, y + 8);
        doc.fillColor('#475569').fontSize(8.5).font('Helvetica');
        doc.text(`Billing Period: ${billingPeriodStr}`, 314, y + 24);
        doc.text(`SAC Code: ${hsnSacCode} (Educational Assessment Services)`, 314, y + 36);
        doc.text(`Reverse Charge Applicable: ${data.reverseCharge ? 'Yes' : 'No'}`, 314, y + 48);
        doc.text(`Status: ${data.status}`, 314, y + 60);
        doc.text(`Supplier Address: ${supplierAddress}`, 314, y + 72, { width: 235 });
        if (data.supplierEmail || data.supplierPhone) {
          doc.text(`Contact: ${data.supplierEmail || ''} ${data.supplierPhone ? '• ' + data.supplierPhone : ''}`, 314, y + 96, { width: 235 });
        }

        y += 125;

        // ── 3. PARTICULARS TABLE ──────────────────────────────────
        doc.rect(36, y, 523, 22).fill('#0f172a');
        doc.fillColor('#ffffff')
          .fontSize(8)
          .font('Helvetica-Bold')
          .text('SR', 42, y + 7)
          .text('DESCRIPTION OF SERVICE', 65, y + 7)
          .text('SAC', 240, y + 7)
          .text('QTY (STUDENTS)', 285, y + 7, { align: 'right', width: 75 })
          .text('RATE (INR)', 370, y + 7, { align: 'right', width: 75 })
          .text('TAXABLE VALUE (INR)', 455, y + 7, { align: 'right', width: 95 });

        y += 22;

        // Table Row
        const rowHeight = 36;
        doc.rect(36, y, 523, rowHeight).stroke('#e2e8f0');
        doc.fillColor('#0f172a').fontSize(8.5).font('Helvetica');
        doc.text('1', 42, y + 10);
        doc.text(
          data.description || `Student Platform Assessment & Examination Subscription (${billingPeriodStr})`,
          65,
          y + 6,
          { width: 170 },
        );
        doc.text(hsnSacCode, 240, y + 10);
        doc.text(studentCount > 0 ? studentCount.toLocaleString('en-IN') : '—', 285, y + 10, { align: 'right', width: 75 });
        doc.text(`₹${pricePerStudent.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 370, y + 10, { align: 'right', width: 75 });
        doc.font('Helvetica-Bold').text(`₹${taxableVal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 455, y + 10, { align: 'right', width: 95 });

        y += rowHeight + 10;

        // ── 4. TAX BREAKDOWN & TOTALS ──────────────────────────────
        const breakdownY = y;
        const isInterState = Boolean(data.isInterState);

        // Left box: Amount in Words & Bank Details
        doc.rect(36, breakdownY, 280, 150).fill('#f8fafc').stroke('#cbd5e1');
        doc.fillColor('#1e293b').fontSize(8.5).font('Helvetica-Bold').text('AMOUNT IN WORDS:', 46, breakdownY + 8);
        doc.fillColor('#047857').fontSize(9).font('Helvetica-Bold').text(amountWords, 46, breakdownY + 20, { width: 260 });

        doc.fillColor('#1e293b').fontSize(8.5).font('Helvetica-Bold').text('BANK & PAYMENT DETAILS:', 46, breakdownY + 50);
        doc.fillColor('#475569').fontSize(8).font('Helvetica');
        doc.text(`Bank Name: ${data.bankName || 'HDFC Bank'}`, 46, breakdownY + 64);
        doc.text(`Account No: ${data.bankAccountNumber || '50200012345678'}`, 46, breakdownY + 76);
        doc.text(`IFSC Code: ${data.bankIfsc || 'HDFC0001234'}`, 46, breakdownY + 88);
        doc.text(`Branch: ${data.bankBranch || 'Koramangala, Bangalore'}`, 46, breakdownY + 100);
        doc.text('Payment Terms: Net 15 Days from Invoice Date', 46, breakdownY + 114);

        // Right box: GST Calculation & Grand Total
        doc.rect(326, breakdownY, 233, 150).fill('#ffffff').stroke('#cbd5e1');
        let calcY = breakdownY + 8;

        doc.fillColor('#475569').fontSize(8.5).font('Helvetica');
        doc.text('Taxable Subtotal:', 336, calcY).text(`₹${taxableVal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 450, calcY, { align: 'right', width: 100 });

        calcY += 16;
        if (!isInterState) {
          const cgstRate = data.cgstRate ?? 9;
          const cgstAmt = data.cgstAmount ?? (taxableVal * cgstRate) / 100;
          doc.text(`Central GST (CGST @ ${cgstRate}%):`, 336, calcY).text(`₹${cgstAmt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 450, calcY, { align: 'right', width: 100 });

          calcY += 16;
          const sgstRate = data.sgstRate ?? 9;
          const sgstAmt = data.sgstAmount ?? (taxableVal * sgstRate) / 100;
          doc.text(`State GST (SGST @ ${sgstRate}%):`, 336, calcY).text(`₹${sgstAmt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 450, calcY, { align: 'right', width: 100 });
        } else {
          const igstRate = data.igstRate ?? 18;
          const igstAmt = data.igstAmount ?? (taxableVal * igstRate) / 100;
          doc.text(`Integrated GST (IGST @ ${igstRate}%):`, 336, calcY).text(`₹${igstAmt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 450, calcY, { align: 'right', width: 100 });
        }

        if (data.cessAmount && data.cessAmount > 0) {
          calcY += 16;
          doc.text(`Applicable Cess (${data.cessRate || 0}%):`, 336, calcY).text(`₹${data.cessAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 450, calcY, { align: 'right', width: 100 });
        }

        calcY += 16;
        doc.text('Total GST / Tax:', 336, calcY).text(`₹${data.tax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 450, calcY, { align: 'right', width: 100 });

        calcY += 20;
        doc.rect(326, calcY - 4, 233, 28).fill('#0f172a');
        doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold');
        doc.text('Grand Total (INR):', 336, calcY + 3).text(`₹${data.totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 440, calcY + 3, { align: 'right', width: 110 });

        y = breakdownY + 160;

        // ── 5. DECLARATION & SIGNATURE ────────────────────────────
        doc.rect(36, y, 320, 65).stroke('#e2e8f0');
        doc.fillColor('#475569').fontSize(7.5).font('Helvetica-Bold').text('DECLARATION & TERMS:', 46, y + 6);
        doc.font('Helvetica').text('1. We declare that this invoice shows the actual price of services described and that all particulars are true and correct.', 46, y + 18, { width: 300 });
        doc.text('2. Place of supply is determined as per Section 12/13 of the IGST Act, 2017.', 46, y + 36, { width: 300 });
        doc.text('3. This is a system-generated Tax Invoice generated under Brainros Platform.', 46, y + 48, { width: 300 });

        doc.rect(366, y, 193, 65).stroke('#e2e8f0');
        doc.fillColor('#1e293b').fontSize(8).font('Helvetica-Bold').text(`For ${supplierName}`, 376, y + 6, { width: 175 });
        doc.fillColor('#64748b').fontSize(7.5).font('Helvetica').text('Authorized Signatory / Digitally Signed', 376, y + 48, { width: 175 });

        // Footer note
        doc.fillColor('#94a3b8')
          .fontSize(7.5)
          .text('Indian GST-Compliant Electronic Invoice • Brainros Assessment Systems • Generated via Secure Cloud Backend', 36, 785, { align: 'center', width: 523 });

        doc.end();
      } catch (err) {
        this.logger.error(`Error compiling GST bill PDF: ${(err as any).message}`);
        reject(err);
      }
    });
  }
}
