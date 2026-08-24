import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Query, UseGuards,
} from '@nestjs/common';
import { AcademicService } from './academic.service';
import {
  CreateSubjectDto, UpdateSubjectDto,
  CreateChapterDto, UpdateChapterDto,
  CreateTopicDto, UpdateTopicDto,
  CreateSubTopicDto, UpdateSubTopicDto,
} from './dto/academic.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('academic')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AcademicController {
  constructor(private readonly academicService: AcademicService) {}

  // ─── Lookup Data (public for authenticated users) ────────────
  @Get('difficulty-levels')
  getDifficultyLevels() {
    return this.academicService.getDifficultyLevels();
  }

  @Get('question-types')
  getQuestionTypes() {
    return this.academicService.getQuestionTypes();
  }

  @Get('exam-statuses')
  getExamStatuses() {
    return this.academicService.getExamStatuses();
  }

  @Get('hierarchy/:examTargetId')
  getHierarchy(@Param('examTargetId') examTargetId: string) {
    return this.academicService.getHierarchy(examTargetId);
  }

  // ─── Subjects ────────────────────────────────────────────────
  @Post('subjects')
  @Roles('ADMIN', 'SUPER_ADMIN')
  createSubject(@Body() dto: CreateSubjectDto) {
    return this.academicService.createSubject(dto);
  }

  @Get('subjects')
  findAllSubjects(@Query('examTargetId') examTargetId?: string) {
    return this.academicService.findAllSubjects(examTargetId);
  }

  @Get('subjects/:id')
  findSubjectById(@Param('id') id: string) {
    return this.academicService.findSubjectById(id);
  }

  @Patch('subjects/:id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  updateSubject(@Param('id') id: string, @Body() dto: UpdateSubjectDto) {
    return this.academicService.updateSubject(id, dto);
  }

  @Delete('subjects/:id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  deleteSubject(@Param('id') id: string) {
    return this.academicService.deleteSubject(id);
  }

  // ─── Chapters ────────────────────────────────────────────────
  @Post('chapters')
  @Roles('ADMIN', 'SUPER_ADMIN')
  createChapter(@Body() dto: CreateChapterDto) {
    return this.academicService.createChapter(dto);
  }

  @Get('subjects/:subjectId/chapters')
  findChaptersBySubject(@Param('subjectId') subjectId: string) {
    return this.academicService.findChaptersBySubject(subjectId);
  }

  @Get('chapters/:id')
  findChapterById(@Param('id') id: string) {
    return this.academicService.findChapterById(id);
  }

  @Patch('chapters/:id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  updateChapter(@Param('id') id: string, @Body() dto: UpdateChapterDto) {
    return this.academicService.updateChapter(id, dto);
  }

  @Delete('chapters/:id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  deleteChapter(@Param('id') id: string) {
    return this.academicService.deleteChapter(id);
  }

  // ─── Topics ──────────────────────────────────────────────────
  @Post('topics')
  @Roles('ADMIN', 'SUPER_ADMIN')
  createTopic(@Body() dto: CreateTopicDto) {
    return this.academicService.createTopic(dto);
  }

  @Get('chapters/:chapterId/topics')
  findTopicsByChapter(@Param('chapterId') chapterId: string) {
    return this.academicService.findTopicsByChapter(chapterId);
  }

  @Get('topics/:id')
  findTopicById(@Param('id') id: string) {
    return this.academicService.findTopicById(id);
  }

  @Patch('topics/:id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  updateTopic(@Param('id') id: string, @Body() dto: UpdateTopicDto) {
    return this.academicService.updateTopic(id, dto);
  }

  @Delete('topics/:id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  deleteTopic(@Param('id') id: string) {
    return this.academicService.deleteTopic(id);
  }

  // ─── Sub-Topics ──────────────────────────────────────────────
  @Post('sub-topics')
  @Roles('ADMIN', 'SUPER_ADMIN')
  createSubTopic(@Body() dto: CreateSubTopicDto) {
    return this.academicService.createSubTopic(dto);
  }

  @Get('topics/:topicId/sub-topics')
  findSubTopicsByTopic(@Param('topicId') topicId: string) {
    return this.academicService.findSubTopicsByTopic(topicId);
  }

  @Get('sub-topics/:id')
  findSubTopicById(@Param('id') id: string) {
    return this.academicService.findSubTopicById(id);
  }

  @Patch('sub-topics/:id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  updateSubTopic(@Param('id') id: string, @Body() dto: UpdateSubTopicDto) {
    return this.academicService.updateSubTopic(id, dto);
  }

  @Delete('sub-topics/:id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  deleteSubTopic(@Param('id') id: string) {
    return this.academicService.deleteSubTopic(id);
  }
}
