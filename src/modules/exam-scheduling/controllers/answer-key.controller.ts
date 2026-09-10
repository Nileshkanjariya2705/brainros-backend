import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  ParseUUIDPipe,
  UseInterceptors,
  UploadedFile,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AnswerKeyService, AnswerKeyRowInput } from '../services/answer-key.service';

@Controller('admin/schedules/:scheduleId/answer-key')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AnswerKeyController {
  constructor(private readonly answerKeyService: AnswerKeyService) {}

  /**
   * 1. Get Answer Key Status
   * GET /admin/schedules/:scheduleId/answer-key/status
   */
  @Get('status')
  @Roles('ADMIN', 'SUPER_ADMIN', 'OPERATOR')
  async getAnswerKeyStatus(@Param('scheduleId', ParseUUIDPipe) scheduleId: string) {
    const data = await this.answerKeyService.getAnswerKeyStatus(scheduleId);
    return {
      statusCode: 200,
      message: 'Answer key status fetched successfully',
      data,
    };
  }

  /**
   * 2. Download Pre-filled Template (JSON or CSV download)
   * GET /admin/schedules/:scheduleId/answer-key/template
   */
  @Get('template')
  @Roles('ADMIN', 'SUPER_ADMIN', 'OPERATOR')
  async getAnswerKeyTemplate(
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
    @Res() res: Response,
  ) {
    const data = await this.answerKeyService.getAnswerKeyTemplate(scheduleId);

    // If client requests CSV directly via header or query, stream as downloadable file
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="AnswerKey_${data.examTitle.replace(/[^a-zA-Z0-9]/g, '_')}_${scheduleId.slice(0, 8)}.csv"`,
    );
    return res.send(data.csvContent);
  }

  /**
   * 3. Get Template Questions metadata for UI Grid Entry
   * GET /admin/schedules/:scheduleId/answer-key/questions
   */
  @Get('questions')
  @Roles('ADMIN', 'SUPER_ADMIN', 'OPERATOR')
  async getAnswerKeyQuestions(@Param('scheduleId', ParseUUIDPipe) scheduleId: string) {
    const data = await this.answerKeyService.getAnswerKeyTemplate(scheduleId);
    return {
      statusCode: 200,
      message: 'Answer key questions fetched successfully',
      data,
    };
  }

  /**
   * 4. Upload Answer Key (JSON payload or CSV/Excel file)
   * POST /admin/schedules/:scheduleId/answer-key
   */
  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN', 'OPERATOR')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAnswerKey(
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { rows?: AnswerKeyRowInput[] | string },
    @CurrentUser('id') userId: string,
    @CurrentUser('roles') userRoles: string[],
  ) {
    let rowsToProcess: AnswerKeyRowInput[] = [];

    if (file) {
      rowsToProcess = await this.answerKeyService.parseCsvAnswerKey(file.buffer);
    } else if (body.rows) {
      if (typeof body.rows === 'string') {
        try {
          rowsToProcess = JSON.parse(body.rows);
        } catch {
          throw new BadRequestException('Invalid JSON in rows field.');
        }
      } else {
        rowsToProcess = body.rows;
      }
    } else {
      throw new BadRequestException(
        'Please provide an Answer Key CSV file or rows JSON array.',
      );
    }

    const data = await this.answerKeyService.uploadAnswerKey(
      scheduleId,
      rowsToProcess,
      userId,
      userRoles || [],
    );

    return {
      statusCode: 200,
      message: data.message,
      data,
    };
  }
}
