import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';

export interface ExamReportPdfData {
  student: {
    name: string;
    studentCode: string;
    email: string;
  };
  exam: {
    title: string;
    examDate?: string | Date;
    totalMarks: number;
    durationMinutes?: number;
  };
  attempt: {
    id: string;
    submittedAt?: string | Date;
    score: number;
    maxScore: number;
    percentage: number;
    accuracy: number;
    totalQuestions: number;
    correctAnswers: number;
    wrongAnswers: number;
    unattempted: number;
    timeUsedSeconds?: number;
    averageTimePerQuestion?: number;
  };
  rank?: {
    rank?: number;
    totalCandidates?: number;
    percentile?: number;
  };
  subjects?: Array<{
    name: string;
    score: number;
    maxScore: number;
    accuracy: number;
    correct: number;
    wrong: number;
    unattempted: number;
    performanceStatus?: string;
  }>;
  chapters?: Array<{
    name: string;
    subjectName?: string;
    accuracy: number;
    performanceStatus?: string;
  }>;
  timeAnalysis?: {
    averageTimePerQuestionSeconds?: number;
    fastestQuestionSeconds?: number;
    slowestQuestionSeconds?: number;
  };
  strategy?: {
    overAttemptingScore?: number;
    avoidableLossMarks?: number;
    riskCategory?: string;
    recommendations?: string[];
  };
}

@Injectable()
export class ExamReportPdfService {
  private readonly logger = new Logger(ExamReportPdfService.name);

  /**
   * Generates a branded, multi-page Brainros Student Performance Report PDF.
   * Returns a Buffer ready for email attachment or storage.
   */
  async generateReportPdf(data: ExamReportPdfData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          margin: 40,
          size: 'A4',
          info: {
            Title: `Brainros Exam Report - ${data.exam.title} - ${data.student.name}`,
            Author: 'Brainros Assessment Engine',
            Subject: 'Official Student Performance Report',
            Keywords: 'Brainros, Live Exam, Student Report, Analytics',
          },
        });

        const buffers: Buffer[] = [];
        doc.on('data', (chunk) => buffers.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', (err) => reject(err));

        // Colors
        const primaryColor = '#4F46E5'; // Indigo
        const secondaryColor = '#0F172A'; // Slate 900
        const accentColor = '#10B981'; // Emerald
        const lightBg = '#F8FAFC'; // Slate 50
        const borderColor = '#E2E8F0'; // Slate 200
        const mutedText = '#64748B'; // Slate 500
        const darkText = '#1E293B'; // Slate 800

        // ═══════════════════════════════════════════════════════════════
        // HEADER / BRANDING BANNER
        // ═══════════════════════════════════════════════════════════════
        doc.rect(40, 40, 515, 65).fill(secondaryColor);

        doc.fillColor('#FFFFFF').fontSize(20).font('Helvetica-Bold').text('BRAINROS', 55, 52);
        doc.fillColor('#94A3B8').fontSize(9).font('Helvetica').text('Official Live Exam Performance Analysis Report', 55, 78);

        const examDateStr = data.exam.examDate
          ? new Date(data.exam.examDate).toLocaleDateString('en-IN', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })
          : 'N/A';

        doc.fillColor('#F1F5F9').fontSize(9).font('Helvetica-Bold').text(data.exam.title, 320, 54, { width: 220, align: 'right' });
        doc.fillColor('#94A3B8').fontSize(8).font('Helvetica').text(`Exam Date: ${examDateStr}`, 320, 78, { width: 220, align: 'right' });

        doc.moveDown(3);

        // ═══════════════════════════════════════════════════════════════
        // CANDIDATE PROFILE BAR
        // ═══════════════════════════════════════════════════════════════
        const profileY = 120;
        doc.rect(40, profileY, 515, 45).fillAndStroke(lightBg, borderColor);

        doc.fillColor(darkText).fontSize(11).font('Helvetica-Bold').text(data.student.name, 55, profileY + 10);
        doc.fillColor(mutedText).fontSize(8).font('Helvetica').text(`Student ID: ${data.student.studentCode || 'N/A'}  |  Email: ${data.student.email}`, 55, profileY + 26);

        if (data.rank && data.rank.rank) {
          doc.fillColor(primaryColor).fontSize(13).font('Helvetica-Bold').text(`Rank: #${data.rank.rank}`, 350, profileY + 8, { width: 190, align: 'right' });
          const percentileStr = data.rank.percentile !== undefined ? `Percentile: ${Number(data.rank.percentile).toFixed(2)}%` : '';
          const totalCandStr = data.rank.totalCandidates ? ` / ${data.rank.totalCandidates.toLocaleString()} candidates` : '';
          doc.fillColor(mutedText).fontSize(8).font('Helvetica').text(`${percentileStr}${totalCandStr}`, 350, profileY + 26, { width: 190, align: 'right' });
        }

        // ═══════════════════════════════════════════════════════════════
        // EXECUTIVE SUMMARY TILES
        // ═══════════════════════════════════════════════════════════════
        const tilesY = 180;
        const tileWidth = 120;
        const tileHeight = 55;
        const tileGap = 11;

        // Tile 1: Score
        doc.rect(40, tilesY, tileWidth, tileHeight).fillAndStroke(lightBg, borderColor);
        doc.fillColor(mutedText).fontSize(8).font('Helvetica-Bold').text('TOTAL SCORE', 50, tilesY + 10);
        doc.fillColor(primaryColor).fontSize(16).font('Helvetica-Bold').text(`${data.attempt.score} / ${data.attempt.maxScore}`, 50, tilesY + 24);

        // Tile 2: Percentage
        doc.rect(40 + tileWidth + tileGap, tilesY, tileWidth, tileHeight).fillAndStroke(lightBg, borderColor);
        doc.fillColor(mutedText).fontSize(8).font('Helvetica-Bold').text('PERCENTAGE', 40 + tileWidth + tileGap + 10, tilesY + 10);
        doc.fillColor(secondaryColor).fontSize(16).font('Helvetica-Bold').text(`${Number(data.attempt.percentage).toFixed(1)}%`, 40 + tileWidth + tileGap + 10, tilesY + 24);

        // Tile 3: Accuracy
        doc.rect(40 + (tileWidth + tileGap) * 2, tilesY, tileWidth, tileHeight).fillAndStroke(lightBg, borderColor);
        doc.fillColor(mutedText).fontSize(8).font('Helvetica-Bold').text('ACCURACY', 40 + (tileWidth + tileGap) * 2 + 10, tilesY + 10);
        doc.fillColor(accentColor).fontSize(16).font('Helvetica-Bold').text(`${Number(data.attempt.accuracy).toFixed(1)}%`, 40 + (tileWidth + tileGap) * 2 + 10, tilesY + 24);

        // Tile 4: Questions Breakdown
        doc.rect(40 + (tileWidth + tileGap) * 3, tilesY, tileWidth, tileHeight).fillAndStroke(lightBg, borderColor);
        doc.fillColor(mutedText).fontSize(8).font('Helvetica-Bold').text('ATTEMPT STATUS', 40 + (tileWidth + tileGap) * 3 + 10, tilesY + 10);
        doc.fillColor(darkText).fontSize(9).font('Helvetica').text(`Correct: ${data.attempt.correctAnswers} | Wrong: ${data.attempt.wrongAnswers}`, 40 + (tileWidth + tileGap) * 3 + 10, tilesY + 25);
        doc.fillColor(mutedText).fontSize(8).font('Helvetica').text(`Unattempted: ${data.attempt.unattempted}`, 40 + (tileWidth + tileGap) * 3 + 10, tilesY + 38);

        // ═══════════════════════════════════════════════════════════════
        // SUBJECT PERFORMANCE TABLE
        // ═══════════════════════════════════════════════════════════════
        let currentY = 255;
        doc.fillColor(secondaryColor).fontSize(12).font('Helvetica-Bold').text('Subject-Wise Performance', 40, currentY);
        currentY += 18;

        // Table Header
        doc.rect(40, currentY, 515, 22).fill(secondaryColor);
        doc.fillColor('#FFFFFF').fontSize(8).font('Helvetica-Bold');
        doc.text('SUBJECT', 50, currentY + 6);
        doc.text('SCORE', 180, currentY + 6);
        doc.text('CORRECT', 260, currentY + 6);
        doc.text('WRONG', 330, currentY + 6);
        doc.text('UNATTEMPTED', 390, currentY + 6);
        doc.text('ACCURACY', 480, currentY + 6);
        currentY += 22;

        const subjects = data.subjects && data.subjects.length > 0 ? data.subjects : [];
        if (subjects.length === 0) {
          doc.rect(40, currentY, 515, 24).fillAndStroke('#FFFFFF', borderColor);
          doc.fillColor(mutedText).fontSize(8).font('Helvetica').text('No subject-level breakdown recorded.', 50, currentY + 7);
          currentY += 24;
        } else {
          subjects.forEach((sub, idx) => {
            const rowBg = idx % 2 === 0 ? '#FFFFFF' : lightBg;
            doc.rect(40, currentY, 515, 22).fillAndStroke(rowBg, borderColor);

            doc.fillColor(darkText).fontSize(8).font('Helvetica-Bold').text(sub.name, 50, currentY + 6);
            doc.fillColor(primaryColor).fontSize(8).font('Helvetica-Bold').text(`${sub.score} / ${sub.maxScore}`, 180, currentY + 6);
            doc.fillColor(accentColor).fontSize(8).font('Helvetica').text(`${sub.correct}`, 260, currentY + 6);
            doc.fillColor('#EF4444').fontSize(8).font('Helvetica').text(`${sub.wrong}`, 330, currentY + 6);
            doc.fillColor(mutedText).fontSize(8).font('Helvetica').text(`${sub.unattempted}`, 390, currentY + 6);
            doc.fillColor(darkText).fontSize(8).font('Helvetica-Bold').text(`${Number(sub.accuracy || 0).toFixed(1)}%`, 480, currentY + 6);

            currentY += 22;
          });
        }

        // ═══════════════════════════════════════════════════════════════
        // TIME & ATTEMPT STRATEGY ANALYSIS
        // ═══════════════════════════════════════════════════════════════
        currentY += 15;
        doc.fillColor(secondaryColor).fontSize(12).font('Helvetica-Bold').text('Time & Strategy Insights', 40, currentY);
        currentY += 18;

        const halfBoxWidth = 250;
        const boxHeight = 75;

        // Left Box: Speed & Time
        doc.rect(40, currentY, halfBoxWidth, boxHeight).fillAndStroke(lightBg, borderColor);
        doc.fillColor(primaryColor).fontSize(9).font('Helvetica-Bold').text('Speed & Time Management', 50, currentY + 10);

        const totalTimeMin = data.attempt.timeUsedSeconds ? Math.floor(data.attempt.timeUsedSeconds / 60) : 0;
        const totalTimeSec = data.attempt.timeUsedSeconds ? data.attempt.timeUsedSeconds % 60 : 0;
        const avgSec = data.timeAnalysis?.averageTimePerQuestionSeconds ?? data.attempt.averageTimePerQuestion ?? 0;

        doc.fillColor(darkText).fontSize(8).font('Helvetica').text(`Total Time Used: ${totalTimeMin}m ${totalTimeSec}s`, 50, currentY + 28);
        doc.fillColor(darkText).fontSize(8).font('Helvetica').text(`Average Time / Question: ${Number(avgSec).toFixed(1)} seconds`, 50, currentY + 42);
        if (data.timeAnalysis?.fastestQuestionSeconds) {
          doc.fillColor(mutedText).fontSize(7.5).font('Helvetica').text(`Fastest: ${data.timeAnalysis.fastestQuestionSeconds}s  |  Slowest: ${data.timeAnalysis.slowestQuestionSeconds || 'N/A'}s`, 50, currentY + 56);
        }

        // Right Box: Strategy & Risk
        doc.rect(305, currentY, halfBoxWidth, boxHeight).fillAndStroke(lightBg, borderColor);
        doc.fillColor(primaryColor).fontSize(9).font('Helvetica-Bold').text('Attempt Strategy & Accuracy Risk', 315, currentY + 10);

        const avoidableLoss = data.strategy?.avoidableLossMarks ?? (data.attempt.wrongAnswers * 1);
        const riskCategory = data.strategy?.riskCategory ?? (data.attempt.accuracy < 60 ? 'HIGH_RISK' : 'BALANCED');

        doc.fillColor(darkText).fontSize(8).font('Helvetica').text(`Avoidable Negative Loss: ~${avoidableLoss} marks`, 315, currentY + 28);
        doc.fillColor(darkText).fontSize(8).font('Helvetica').text(`Risk Profile: ${riskCategory.replace('_', ' ')}`, 315, currentY + 42);
        doc.fillColor(mutedText).fontSize(7.5).font('Helvetica').text(`Over-Attempt Penalty: ${data.strategy?.overAttemptingScore ?? 0} pts`, 315, currentY + 56);

        currentY += boxHeight + 15;

        // ═══════════════════════════════════════════════════════════════
        // RECOMMENDATIONS & ACTIONABLE FEEDBACK
        // ═══════════════════════════════════════════════════════════════
        doc.fillColor(secondaryColor).fontSize(12).font('Helvetica-Bold').text('Actionable Feedback & Recommendations', 40, currentY);
        currentY += 18;

        doc.rect(40, currentY, 515, 65).fillAndStroke(lightBg, borderColor);

        const defaultRecs = [
          data.attempt.accuracy < 70
            ? 'Focus on reducing negative marks by skipping low-confidence questions.'
            : 'Excellent accuracy! Maintain this discipline in mock and live exam simulations.',
          data.attempt.unattempted > 15
            ? 'Work on question scanning speed to increase overall attempt rate without sacrificing accuracy.'
            : 'Strong coverage across exam sections. Continue reviewing chapter-level weak areas.',
        ];

        const recs = (data.strategy?.recommendations && data.strategy.recommendations.length > 0)
          ? data.strategy.recommendations
          : defaultRecs;

        let recY = currentY + 12;
        recs.slice(0, 3).forEach((rec) => {
          doc.fillColor(primaryColor).fontSize(8).font('Helvetica-Bold').text('•', 52, recY);
          doc.fillColor(darkText).fontSize(8).font('Helvetica').text(rec, 65, recY, { width: 475 });
          recY += 16;
        });

        // ═══════════════════════════════════════════════════════════════
        // FOOTER
        // ═══════════════════════════════════════════════════════════════
        const footerY = 770;
        doc.rect(40, footerY, 515, 0.5).fill(borderColor);
        doc.fillColor(mutedText).fontSize(7.5).font('Helvetica').text(
          `Brainros Exam Management System  •  Generated on ${new Date().toLocaleString('en-IN')}  •  Confidential Student Report`,
          40,
          footerY + 8,
          { width: 515, align: 'center' },
        );

        doc.end();
      } catch (err) {
        this.logger.error(`[ExamReportPdfService] Failed to generate PDF: ${err.message}`, err.stack);
        reject(err);
      }
    });
  }
}
