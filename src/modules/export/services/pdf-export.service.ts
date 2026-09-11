import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';

export interface ColumnDefinition {
  header: string;
  key: string;
  width?: number; // relative weight or point width
  align?: 'left' | 'center' | 'right';
  format?: (val: any, row: any) => string;
}

export interface PdfExportOptions {
  title: string;
  subtitle?: string;
  orientation?: 'portrait' | 'landscape';
  columns: ColumnDefinition[];
  data: Record<string, any>[];
  filterSummary?: Record<string, string>;
  generatedBy?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class PdfExportService {
  private readonly logger = new Logger(PdfExportService.name);

  /**
   * Format Indian Rupee Currency: ₹1,23,456.00
   */
  formatCurrency(amount: number | null | undefined): string {
    if (amount === null || amount === undefined || isNaN(amount)) return '₹0.00';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
    }).format(amount);
  }

  /**
   * Format dates for human readable display
   */
  formatDate(date: Date | string | null | undefined): string {
    if (!date) return '—';
    try {
      const d = new Date(date);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return '—';
    }
  }

  /**
   * Core method to generate a professional, branded PDF buffer
   */
  async generateTablePdf(options: PdfExportOptions): Promise<Buffer> {
    const {
      title,
      subtitle,
      orientation = 'portrait',
      columns,
      data,
      filterSummary,
      generatedBy,
    } = options;

    return new Promise((resolve, reject) => {
      const isLandscape = orientation === 'landscape';
      const doc = new PDFDocument({
        size: 'A4',
        layout: orientation,
        margin: 36, // 0.5 inch margins
        bufferPages: true,
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => {
        try {
          const totalPages = doc.bufferedPageRange().count;
          for (let i = 0; i < totalPages; i++) {
            doc.switchToPage(i);
            this.drawFooter(doc, i + 1, totalPages, isLandscape);
          }
          doc.flushPages();
          resolve(Buffer.concat(chunks));
        } catch (err) {
          reject(err);
        }
      });
      doc.on('error', (err) => reject(err));

      const pageWidth = isLandscape ? 841.89 : 595.28;
      const pageHeight = isLandscape ? 595.28 : 841.89;
      const contentWidth = pageWidth - 72; // 36 margin left + right

      // 1. Draw Branded Header
      this.drawHeader(doc, title, subtitle, filterSummary, generatedBy, contentWidth);

      // 2. Draw Table
      this.drawTable(doc, columns, data, contentWidth, pageHeight);

      doc.end();
    });
  }

  private drawHeader(
    doc: any,
    title: string,
    subtitle?: string,
    filterSummary?: Record<string, string>,
    generatedBy?: string,
    contentWidth = 523,
  ) {
    const startY = doc.y;

    // Top Brand Accent Line
    doc
      .rect(36, 36, contentWidth, 4)
      .fill('#4F46E5'); // Brand Indigo

    doc.y = 46;

    // Logo & Brand Name
    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .fillColor('#1E1B4B')
      .text('BRAINROS', 36, doc.y, { continued: true })
      .font('Helvetica')
      .fontSize(11)
      .fillColor('#6B7280')
      .text('  |  Official Examination & Academic Management System');

    doc.moveDown(0.4);

    // Document Title
    doc
      .font('Helvetica-Bold')
      .fontSize(14)
      .fillColor('#111827')
      .text(title);

    if (subtitle) {
      doc
        .font('Helvetica')
        .fontSize(9.5)
        .fillColor('#4B5563')
        .text(subtitle);
    }

    doc.moveDown(0.4);

    // Generation Info and Filters Box
    const nowStr = new Date().toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    const infoText = `Generated: ${nowStr}${generatedBy ? `  •  User: ${generatedBy}` : ''}`;
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor('#6B7280')
      .text(infoText);

    if (filterSummary && Object.keys(filterSummary).length > 0) {
      const activeFilters = Object.entries(filterSummary)
        .filter(([_, val]) => Boolean(val) && val !== 'All' && val !== 'ALL')
        .map(([k, v]) => `${k}: ${v}`)
        .join('   |   ');

      if (activeFilters) {
        doc.moveDown(0.2);
        doc
          .font('Helvetica-Bold')
          .fontSize(8.5)
          .fillColor('#374151')
          .text('Applied Filters: ', { continued: true })
          .font('Helvetica')
          .fillColor('#4F46E5')
          .text(activeFilters);
      }
    }

    doc.moveDown(0.6);

    // Separator line
    doc
      .strokeColor('#E5E7EB')
      .lineWidth(0.8)
      .moveTo(36, doc.y)
      .lineTo(36 + contentWidth, doc.y)
      .stroke();

    doc.moveDown(0.8);
  }

  private drawTable(
    doc: any,
    columns: ColumnDefinition[],
    data: Record<string, any>[],
    contentWidth: number,
    pageHeight: number,
  ) {
    if (data.length === 0) {
      doc
        .font('Helvetica-Oblique')
        .fontSize(10)
        .fillColor('#6B7280')
        .text('No matching records found for the selected criteria.', 36, doc.y + 20, {
          align: 'center',
        });
      return;
    }

    // Calculate Column Widths
    const totalWeights = columns.reduce((acc, c) => acc + (c.width || 1), 0);
    const colWidths = columns.map((c) => ((c.width || 1) / totalWeights) * contentWidth);

    const rowPadding = 5;
    const headerHeight = 22;
    const bottomMargin = 50;

    const renderHeader = () => {
      const currentY = doc.y;
      doc
        .rect(36, currentY, contentWidth, headerHeight)
        .fill('#F3F4F6'); // Light slate header background

      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#1F2937');

      let currentX = 36;
      columns.forEach((col, idx) => {
        const w = colWidths[idx];
        doc.text(col.header.toUpperCase(), currentX + 4, currentY + 6, {
          width: w - 8,
          align: col.align || 'left',
          ellipsis: true,
        });
        currentX += w;
      });

      doc.y = currentY + headerHeight;
    };

    renderHeader();

    // Render Data Rows
    data.forEach((row, rowIndex) => {
      // Format row values to calculate height
      const formattedCells = columns.map((col) => {
        let val = row[col.key];
        if (col.format) {
          val = col.format(val, row);
        } else if (val === null || val === undefined) {
          val = '—';
        } else if (typeof val === 'boolean') {
          val = val ? 'Yes' : 'No';
        } else if (val instanceof Date) {
          val = this.formatDate(val);
        }
        return String(val);
      });

      doc.font('Helvetica').fontSize(8);

      // Measure max cell height for wrapping
      let maxCellHeight = 16;
      formattedCells.forEach((text, idx) => {
        const w = colWidths[idx] - 8;
        const h = doc.heightOfString(text, { width: w }) + rowPadding * 2;
        if (h > maxCellHeight) maxCellHeight = h;
      });

      const rowHeight = Math.min(maxCellHeight, 60); // Cap row height to prevent runaway cells

      // Check for Page Overflow
      if (doc.y + rowHeight > pageHeight - bottomMargin) {
        doc.addPage();
        renderHeader();
      }

      const rowY = doc.y;

      // Alternating Row Background
      if (rowIndex % 2 === 1) {
        doc
          .rect(36, rowY, contentWidth, rowHeight)
          .fill('#F9FAFB');
      }

      // Border bottom
      doc
        .strokeColor('#F3F4F6')
        .lineWidth(0.5)
        .moveTo(36, rowY + rowHeight)
        .lineTo(36 + contentWidth, rowY + rowHeight)
        .stroke();

      // Render cells
      let currentX = 36;
      formattedCells.forEach((text, idx) => {
        const col = columns[idx];
        const w = colWidths[idx];

        doc.font('Helvetica').fontSize(8).fillColor('#374151');
        doc.text(text, currentX + 4, rowY + rowPadding, {
          width: w - 8,
          height: rowHeight - rowPadding * 2,
          align: col.align || 'left',
          ellipsis: true,
        });

        currentX += w;
      });

      doc.y = rowY + rowHeight;
    });
  }

  private drawFooter(
    doc: any,
    pageNumber: number,
    totalPages: number,
    isLandscape: boolean,
  ) {
    const pageWidth = isLandscape ? 841.89 : 595.28;
    const pageHeight = isLandscape ? 595.28 : 841.89;
    const contentWidth = pageWidth - 72;

    const footerY = pageHeight - 32;

    // Divider Line
    doc
      .strokeColor('#E5E7EB')
      .lineWidth(0.5)
      .moveTo(36, footerY - 6)
      .lineTo(36 + contentWidth, footerY - 6)
      .stroke();

    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor('#9CA3AF')
      .text('Confidential — For Authorized Brainros Academic & Institutional Personnel Only', 36, footerY, {
        align: 'left',
      });

    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor('#6B7280')
      .text(`Page ${pageNumber} of ${totalPages}`, 36, footerY, {
        width: contentWidth,
        align: 'right',
      });
  }
}
