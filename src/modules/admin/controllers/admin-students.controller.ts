import {
  Controller,
  Get,
  Post,
  Delete,
  Query,
  Param,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AdminStudentsService } from '../services/admin-students.service';
import {
  AdminStudentsQueryDto,
  AddStudentParentDto,
} from '../dto/admin-students.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

@Controller('admin/students')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminStudentsController {
  constructor(private readonly studentsService: AdminStudentsService) {}

  /**
   * GET /admin/students
   * Production-grade server-side paginated, sorted, filtered student list
   */
  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN')
  async getStudents(@Query() query: AdminStudentsQueryDto, @Req() req: any) {
    const actorUserId = req.user?.id || req.user?.userId;
    return this.studentsService.getStudents(query, actorUserId);
  }

  /**
   * GET /admin/students/filter-options
   * Master data filter options for dynamic dropdowns
   */
  @Get('filter-options')
  @Roles('SUPER_ADMIN', 'ADMIN')
  async getFilterOptions() {
    return this.studentsService.getFilterOptions();
  }

  /**
   * GET /admin/students/:studentId/parents
   * List all linked parents for a given student
   */
  @Get(':studentId/parents')
  @Roles('SUPER_ADMIN', 'ADMIN')
  async getStudentParents(@Param('studentId') studentId: string) {
    return this.studentsService.getStudentParents(studentId);
  }

  /**
   * POST /admin/students/:studentId/parents
   * Add/Link parent to a student (creates or reuses Parent user)
   */
  @Post(':studentId/parents')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(HttpStatus.CREATED)
  async addParentToStudent(
    @Param('studentId') studentId: string,
    @Body() dto: AddStudentParentDto,
    @Req() req: any,
  ) {
    const actorUserId = req.user?.id || req.user?.userId;
    return this.studentsService.addParentToStudent(studentId, dto, actorUserId);
  }

  /**
   * DELETE /admin/students/:studentId/parents/:linkId
   * Revoke/Unlink parent relationship
   */
  @Delete(':studentId/parents/:linkId')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  async revokeParentLink(
    @Param('studentId') studentId: string,
    @Param('linkId') linkId: string,
    @Req() req: any,
  ) {
    const actorUserId = req.user?.id || req.user?.userId;
    return this.studentsService.revokeParentLink(studentId, linkId, actorUserId);
  }
}
