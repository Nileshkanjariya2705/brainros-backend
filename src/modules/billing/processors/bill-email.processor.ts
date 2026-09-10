import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { ResendEmailService } from '../../admin/services/resend-email.service';
import { BillPdfService } from '../services/bill-pdf.service';
import { JobProgressService } from '../../job-progress/services/job-progress.service';

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

export interface BillEmailJobData {
  billId: string;
  recipientEmail: string;
  schoolName: string;
  requestedById?: string;
}

@Processor('bill-email', {
  concurrency: 3,
})
export class BillEmailProcessor extends WorkerHost {
  private readonly logger = new Logger(BillEmailProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resendEmailService: ResendEmailService,
    private readonly pdfService: BillPdfService,
    private readonly jobProgressService: JobProgressService,
  ) {
    super();
  }

  @OnWorkerEvent('error')
  onError(err: Error) {
    this.logger.warn(`Bill email worker runtime warning: ${err.message}`);
  }

  async process(job: Job<BillEmailJobData>): Promise<any> {
    const { billId, recipientEmail, schoolName, requestedById } = job.data;
    this.logger.log(`[BillEmailProcessor] Processing bill email dispatch for bill '${billId}' -> ${recipientEmail}`);

    try {
      // 1. Mark emailStatus as PROCESSING in DB
      await this.prisma.bill.update({
        where: { id: billId },
        data: { emailStatus: 'PROCESSING', emailFailedReason: null },
      });

      await this.jobProgressService.publishStarted(
        'bill-email',
        job.id!,
        'BILL_EMAIL',
        `Compiling invoice PDF for ${schoolName}...`,
        { billId, recipientEmail },
      );

      const bill = await this.prisma.bill.findUnique({
        where: { id: billId },
        include: {
          institution: true,
          createdBy: true,
          approvedBy: true,
        },
      });

      if (!bill) {
        throw new Error(`Bill '${billId}' not found.`);
      }

      // 2. Generate PDF Invoice Buffer
      const pdfBuffer = await this.pdfService.generateBillPdf({
        billNumber: bill.billNumber,
        billDate: bill.billDate,
        billingMonth: bill.billingMonth,
        billingYear: bill.billingYear,
        schoolName: bill.institution.name,
        schoolCode: bill.institution.code,
        schoolEmail: bill.institution.email || undefined,
        schoolPhone: bill.institution.phone || undefined,
        schoolAddress: bill.institution.address || undefined,
        studentCount: bill.studentCount,
        pricePerStudent: bill.pricePerStudent,
        description: bill.description || 'Institutional Assessment Platform Services',
        amount: bill.amount,
        tax: bill.tax,
        totalAmount: bill.totalAmount,
        status: bill.status,
        createdByName: bill.createdBy?.name || 'Accounts Staff',
        approvedByName: bill.approvedBy?.name || 'Super Admin',
        approvedAt: bill.approvedAt || undefined,
      });

      // 3. Publish Progress (PDF generated, dispatching email)
      await this.jobProgressService.publishProgress(
        'bill-email',
        job.id!,
        1,
        2,
        {
          stage: 'DISPATCHING_EMAIL',
          message: `Sending email to ${recipientEmail} via Resend...`,
        },
      );

      const billingPeriodStr =
        bill.billingMonth && bill.billingYear
          ? `${MONTH_NAMES[bill.billingMonth] || 'Month ' + bill.billingMonth} ${bill.billingYear}`
          : new Date(bill.billDate).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

      // 4. Dispatch via Resend API
      const emailHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; line-height: 1.6;">
          <div style="background-color: #0f172a; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="color: #38bdf8; margin: 0; font-size: 26px; letter-spacing: -0.5px;">BRAINROS</h1>
            <p style="color: #94a3b8; margin: 6px 0 0; font-size: 13px;">Exam Management & Assessment Platform</p>
          </div>
          <div style="padding: 30px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px; background: #ffffff;">
            <h2 style="color: #0f172a; margin-top: 0; font-size: 20px;">Brainros Invoice - ${billingPeriodStr}</h2>
            <p style="font-size: 15px;">Dear <strong>${bill.institution.name}</strong>,</p>
            <p style="font-size: 14px; color: #475569;">Please find attached your Brainros invoice for <strong>${billingPeriodStr}</strong>.</p>
            
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin: 24px 0;">
              <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                <tr>
                  <td style="padding: 6px 0; color: #64748b;">Invoice Number:</td>
                  <td style="padding: 6px 0; font-weight: 600; text-align: right; color: #0f172a;">${bill.billNumber}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b;">Billing Period:</td>
                  <td style="padding: 6px 0; font-weight: 600; text-align: right; color: #0f172a;">${billingPeriodStr}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b;">Eligible Students:</td>
                  <td style="padding: 6px 0; font-weight: 600; text-align: right; color: #0f172a;">${bill.studentCount.toLocaleString('en-IN')}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b;">Rate per Student:</td>
                  <td style="padding: 6px 0; font-weight: 600; text-align: right; color: #0f172a;">₹${bill.pricePerStudent.toLocaleString('en-IN')}</td>
                </tr>
                <tr style="border-top: 2px solid #e2e8f0;">
                  <td style="padding: 12px 0 6px; font-weight: 700; font-size: 16px; color: #0f172a;">Total Amount:</td>
                  <td style="padding: 12px 0 6px; font-weight: 700; font-size: 18px; color: #0284c7; text-align: right;">₹${bill.totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                </tr>
              </table>
            </div>

            <p style="font-size: 13px; color: #64748b; margin-bottom: 24px;">
              The itemized PDF invoice is attached. For any billing inquiries or bank transfer confirmations, please contact your account manager.
            </p>

            <p style="font-size: 14px; margin: 0; color: #334155;">
              Regards,<br />
              <strong>Brainros Team</strong>
            </p>

            <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0;" />
            <p style="font-size: 11px; color: #94a3b8; text-align: center; margin: 0;">
              Brainros Platform • Automated Institutional Billing System
            </p>
          </div>
        </div>
      `;

      const result = await this.resendEmailService.sendEmail({
        to: recipientEmail,
        subject: `Brainros Invoice - ${billingPeriodStr}`,
        html: emailHtml,
        attachments: [
          {
            filename: `Invoice_${bill.billNumber}.pdf`,
            content: pdfBuffer,
          },
        ],
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to dispatch email via Resend.');
      }

      // 5. Update Bill record with sentAt timestamp, emailStatus = SENT, status = SENT
      await this.prisma.bill.update({
        where: { id: bill.id },
        data: {
          sentAt: new Date(),
          emailStatus: 'SENT',
          status: 'SENT',
          emailFailedReason: null,
        },
      });

      // 6. Audit Log
      await this.prisma.auditLog.create({
        data: {
          actorUserId: requestedById,
          action: 'BILL_SENT',
          entityType: 'BILL',
          entityId: bill.id,
          metadata: {
            billNumber: bill.billNumber,
            recipientEmail,
            messageId: result.messageId,
            sentAt: new Date().toISOString(),
          },
        },
      });

      await this.jobProgressService.publishCompleted(
        'bill-email',
        job.id!,
        `Invoice successfully dispatched to ${recipientEmail}`,
        { messageId: result.messageId },
      );

      this.logger.log(`[BillEmailProcessor] Successfully delivered invoice ${bill.billNumber} to ${recipientEmail}`);
      return { success: true, messageId: result.messageId };
    } catch (err: any) {
      this.logger.error(`[BillEmailProcessor] Failed sending bill email: ${err.message}`);

      // Update emailStatus to FAILED in DB
      try {
        await this.prisma.bill.update({
          where: { id: billId },
          data: {
            emailStatus: 'FAILED',
            emailFailedReason: (err.message || 'Unknown delivery failure').slice(0, 500),
          },
        });
      } catch (dbErr) {
        this.logger.error(`Failed to update bill emailStatus to FAILED: ${(dbErr as any).message}`);
      }

      await this.jobProgressService.publishFailed(
        'bill-email',
        job.id!,
        `Failed to send invoice email: ${err.message}`,
        'BILL_EMAIL_ERROR',
      );
      throw err;
    }
  }
}

