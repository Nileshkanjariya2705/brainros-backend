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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { LanguageService } from '../services/language.service';
import { CreateLanguageDto, UpdateLanguageDto } from '../dto/language.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

@Controller('languages')
export class LanguageController {
  constructor(private readonly languageService: LanguageService) {}

  /**
   * List all supported regional languages
   * GET /languages
   */
  @Get()
  getAllLanguages(@Query('includeInactive') includeInactive?: string) {
    return this.languageService.getAllLanguages(includeInactive === 'true');
  }

  /**
   * Get language by ID
   * GET /languages/:id
   */
  @Get(':id')
  getLanguageById(@Param('id') id: string) {
    return this.languageService.getLanguageById(id);
  }

  /**
   * Create a new language (Admin/SuperAdmin)
   * POST /languages
   */
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @HttpCode(HttpStatus.CREATED)
  createLanguage(@Body() dto: CreateLanguageDto) {
    return this.languageService.createLanguage(dto);
  }

  /**
   * Update language properties (Admin/SuperAdmin)
   * PATCH /languages/:id
   */
  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  updateLanguage(
    @Param('id') id: string,
    @Body() dto: UpdateLanguageDto,
  ) {
    return this.languageService.updateLanguage(id, dto);
  }

  /**
   * Delete language (Admin/SuperAdmin)
   * DELETE /languages/:id
   */
  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  deleteLanguage(@Param('id') id: string) {
    return this.languageService.deleteLanguage(id);
  }
}
