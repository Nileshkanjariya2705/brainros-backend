import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { BlueprintService } from '../services/blueprint.service';
import { ExamGenerationService } from '../services/exam-generation.service';
import {
  CreateBlueprintDto,
  UpdateBlueprintDto,
  CreateBlueprintRuleDto,
  UpdateBlueprintRuleDto,
} from '../dto/blueprint.dto';
import { ValidateBlueprintDto } from '../dto/generate-exam.dto';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExamBlueprintController {
  constructor(
    private readonly blueprintService: BlueprintService,
    private readonly generationService: ExamGenerationService,
  ) {}

  @Post('exams/:examId/blueprints')
  @Roles('SUPER_ADMIN', 'ADMIN')
  async createBlueprint(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Body() dto: CreateBlueprintDto,
    @CurrentUser('id') userId: string,
  ) {
    const data = await this.blueprintService.createBlueprint(examId, dto, userId);
    return {
      statusCode: 201,
      message: 'Exam blueprint created successfully',
      data,
    };
  }

  @Get('exams/:examId/blueprints')
  @Roles('SUPER_ADMIN', 'ADMIN', 'STUDENT')
  async getExamBlueprints(@Param('examId', ParseUUIDPipe) examId: string) {
    const data = await this.blueprintService.getExamBlueprints(examId);
    return {
      statusCode: 200,
      message: 'Exam blueprints fetched successfully',
      data,
    };
  }

  @Get('blueprints/:id')
  @Roles('SUPER_ADMIN', 'ADMIN', 'STUDENT')
  async getBlueprintById(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.blueprintService.getBlueprintById(id);
    return {
      statusCode: 200,
      message: 'Blueprint fetched successfully',
      data,
    };
  }

  @Patch('blueprints/:id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  async updateBlueprint(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBlueprintDto,
  ) {
    const data = await this.blueprintService.updateBlueprint(id, dto);
    return {
      statusCode: 200,
      message: 'Blueprint updated successfully',
      data,
    };
  }

  @Delete('blueprints/:id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  async deleteBlueprint(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.blueprintService.deleteBlueprint(id);
    return {
      statusCode: 200,
      message: data.message,
    };
  }

  @Post('blueprints/:blueprintId/rules')
  @Roles('SUPER_ADMIN', 'ADMIN')
  async addRule(
    @Param('blueprintId', ParseUUIDPipe) blueprintId: string,
    @Body() dto: CreateBlueprintRuleDto,
  ) {
    const data = await this.blueprintService.addRule(blueprintId, dto);
    return {
      statusCode: 201,
      message: 'Blueprint rule added successfully',
      data,
    };
  }

  @Patch('blueprints/rules/:ruleId')
  @Roles('SUPER_ADMIN', 'ADMIN')
  async updateRule(
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @Body() dto: UpdateBlueprintRuleDto,
  ) {
    const data = await this.blueprintService.updateRule(ruleId, dto);
    return {
      statusCode: 200,
      message: 'Blueprint rule updated successfully',
      data,
    };
  }

  @Delete('blueprints/rules/:ruleId')
  @Roles('SUPER_ADMIN', 'ADMIN')
  async deleteRule(@Param('ruleId', ParseUUIDPipe) ruleId: string) {
    const data = await this.blueprintService.deleteRule(ruleId);
    return {
      statusCode: 200,
      message: data.message,
    };
  }

  @Post('blueprints/:blueprintId/validate')
  @Roles('SUPER_ADMIN', 'ADMIN')
  async validateBlueprint(
    @Param('blueprintId', ParseUUIDPipe) blueprintId: string,
    @Body() dto: ValidateBlueprintDto,
  ) {
    const data = await this.generationService.validateBlueprintForExam(blueprintId, dto);
    return {
      statusCode: 200,
      message: 'Blueprint validation and pool distribution completed',
      data,
    };
  }
}
