import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InstitutionService } from '../services/institution.service';
import { InstitutionAccessService } from '../services/institution-access.service';
import {
  CreateInstitutionDto,
  UpdateInstitutionDto,
  UpdateInstitutionStatusDto,
  AssignAdminDto,
  InstitutionQueryDto,
} from '../dto/institution.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@Controller('institutions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InstitutionController {
  constructor(
    private readonly institutionService: InstitutionService,
    private readonly accessService: InstitutionAccessService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════
  // INSTITUTION ADMIN SELF-SCOPED ENDPOINTS (/institutions/me)
  // ═══════════════════════════════════════════════════════════════════

  @Get('me')
  async getMyInstitution(@CurrentUser() user: any) {
    const { institution, admin } = await this.accessService.getMyInstitution(
      user.userId,
    );
    return {
      institution,
      adminRole: admin.role,
    };
  }

  @Patch('me')
  async updateMyInstitution(
    @CurrentUser() user: any,
    @Body() dto: UpdateInstitutionDto,
  ) {
    const { institution } = await this.accessService.getMyInstitution(
      user.userId,
    );
    return this.institutionService.update(institution.id, dto);
  }

  // ═══════════════════════════════════════════════════════════════════
  // SUPER ADMIN MANAGEMENT ENDPOINTS (/institutions)
  // ═══════════════════════════════════════════════════════════════════

  @Post()
  async createInstitution(
    @CurrentUser() user: any,
    @Body() dto: CreateInstitutionDto,
  ) {
    return this.institutionService.create(dto, user.userId);
  }

  @Get()
  async listInstitutions(@Query() query: InstitutionQueryDto) {
    return this.institutionService.findAll(query);
  }

  @Get(':id')
  async getInstitutionById(@Param('id') id: string) {
    return this.institutionService.findById(id);
  }

  @Patch(':id/status')
  async updateInstitutionStatus(
    @Param('id') id: string,
    @Body() dto: UpdateInstitutionStatusDto,
  ) {
    return this.institutionService.updateStatus(id, dto);
  }

  @Post(':id/admins')
  async assignAdmin(@Param('id') id: string, @Body() dto: AssignAdminDto) {
    return this.institutionService.assignAdmin(id, dto);
  }
}
