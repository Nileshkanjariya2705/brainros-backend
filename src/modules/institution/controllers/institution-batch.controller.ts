import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InstitutionBatchService } from '../services/institution-batch.service';
import { InstitutionAccessService } from '../services/institution-access.service';
import {
  CreateBatchDto,
  UpdateBatchDto,
  AddStudentToBatchDto,
} from '../dto/institution.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@Controller('institutions/me/batches')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InstitutionBatchController {
  constructor(
    private readonly batchService: InstitutionBatchService,
    private readonly accessService: InstitutionAccessService,
  ) {}

  @Get()
  async getBatches(@CurrentUser() user: any, @Query('status') status?: string) {
    const { institution } = await this.accessService.getMyInstitution(
      user.userId,
    );
    return this.batchService.findByInstitution(institution.id, status);
  }

  @Post()
  async createBatch(@CurrentUser() user: any, @Body() dto: CreateBatchDto) {
    const { institution } = await this.accessService.getMyInstitution(
      user.userId,
    );
    return this.batchService.create(institution.id, dto, user.userId);
  }

  @Get(':batchId')
  async getBatchById(
    @CurrentUser() user: any,
    @Param('batchId') batchId: string,
  ) {
    await this.accessService.assertCanAccessBatch(user.userId, batchId);
    return this.batchService.findById(batchId);
  }

  @Patch(':batchId')
  async updateBatch(
    @CurrentUser() user: any,
    @Param('batchId') batchId: string,
    @Body() dto: UpdateBatchDto,
  ) {
    await this.accessService.assertCanAccessBatch(user.userId, batchId);
    return this.batchService.update(batchId, dto);
  }

  @Get(':batchId/students')
  async listBatchStudents(
    @CurrentUser() user: any,
    @Param('batchId') batchId: string,
    @Query('status') status?: string,
  ) {
    await this.accessService.assertCanAccessBatch(user.userId, batchId);
    return this.batchService.listStudents(batchId, status);
  }

  @Post(':batchId/students')
  async addStudentToBatch(
    @CurrentUser() user: any,
    @Param('batchId') batchId: string,
    @Body() dto: AddStudentToBatchDto,
  ) {
    await this.accessService.assertCanAccessBatch(user.userId, batchId);
    return this.batchService.addStudent(batchId, dto.studentId);
  }

  @Delete(':batchId/students/:studentId')
  async removeStudentFromBatch(
    @CurrentUser() user: any,
    @Param('batchId') batchId: string,
    @Param('studentId') studentId: string,
  ) {
    await this.accessService.assertCanAccessBatch(user.userId, batchId);
    return this.batchService.removeStudent(batchId, studentId);
  }
}
