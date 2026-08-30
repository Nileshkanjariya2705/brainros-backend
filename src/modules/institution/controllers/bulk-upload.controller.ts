import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BulkUploadService } from '../services/bulk-upload.service';
import { InstitutionAccessService } from '../services/institution-access.service';
import {
  SubmitBulkUploadDto,
  ReviewBulkUploadDto,
} from '../dto/institution.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@Controller('institutions/me/bulk-uploads')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BulkUploadController {
  constructor(
    private readonly bulkUploadService: BulkUploadService,
    private readonly accessService: InstitutionAccessService,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @CurrentUser() user: any,
    @UploadedFile() file: Express.Multer.File,
    @Body('batchId') batchId?: string,
  ) {
    if (!file) {
      throw new BadRequestException('Please provide a valid CSV or XLSX file.');
    }

    const { institution } = await this.accessService.getMyInstitution(
      user.userId,
    );
    return this.bulkUploadService.uploadFile(
      institution.id,
      batchId || null,
      user.userId,
      file,
    );
  }

  @Get()
  async listUploads(
    @CurrentUser() user: any,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const { institution } = await this.accessService.getMyInstitution(
      user.userId,
    );
    return this.bulkUploadService.listUploads(institution.id, page, limit);
  }

  @Get(':uploadId')
  async getUpload(
    @CurrentUser() user: any,
    @Param('uploadId') uploadId: string,
  ) {
    await this.accessService.assertCanAccessUpload(user.userId, uploadId);
    return this.bulkUploadService.getUploadById(uploadId);
  }

  @Get(':uploadId/preview')
  async getPreview(
    @CurrentUser() user: any,
    @Param('uploadId') uploadId: string,
  ) {
    await this.accessService.assertCanAccessUpload(user.userId, uploadId);
    return this.bulkUploadService.getPreview(uploadId);
  }

  @Get(':uploadId/errors')
  async getErrors(
    @CurrentUser() user: any,
    @Param('uploadId') uploadId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    await this.accessService.assertCanAccessUpload(user.userId, uploadId);
    return this.bulkUploadService.getErrors(uploadId, page, limit);
  }

  @Post(':uploadId/submit')
  async submitForApproval(
    @CurrentUser() user: any,
    @Param('uploadId') uploadId: string,
    @Body() dto: SubmitBulkUploadDto,
  ) {
    await this.accessService.assertCanAccessUpload(user.userId, uploadId);
    return this.bulkUploadService.submitForApproval(
      uploadId,
      user.userId,
      dto.notes,
    );
  }

  @Post(':uploadId/review')
  async reviewUpload(
    @CurrentUser() user: any,
    @Param('uploadId') uploadId: string,
    @Body() dto: ReviewBulkUploadDto,
  ) {
    return this.bulkUploadService.reviewUpload(
      uploadId,
      user.userId,
      dto.action,
      dto.reason,
    );
  }
}
