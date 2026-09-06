# Brainros Backend API Endpoints Directory

Total Endpoints: **402**

### CORE (5 endpoints)
| Method | Route Path |
|---|---|
| `GET` | `/` |
| `GET` | `/health` |
| `GET` | `/helth` |
| `GET` | `/healthz` |
| `GET` | `/ping` |

### ACADEMIC (27 endpoints)
| Method | Route Path |
|---|---|
| `GET` | `/academic/difficulty-levels` |
| `GET` | `/academic/question-types` |
| `GET` | `/academic/exam-statuses` |
| `GET` | `/academic/exam-targets` |
| `GET` | `/academic/hierarchy/:examTargetId` |
| `POST` | `/academic/subjects` |
| `GET` | `/academic/subjects` |
| `GET` | `/academic/subjects/:id` |
| `PATCH` | `/academic/subjects/:id` |
| `DELETE` | `/academic/subjects/:id` |
| `GET` | `/academic/chapters` |
| `POST` | `/academic/chapters` |
| `GET` | `/academic/subjects/:subjectId/chapters` |
| `PATCH` | `/academic/subjects/:subjectId/chapters/reorder` |
| `GET` | `/academic/chapters/:id` |
| `PATCH` | `/academic/chapters/:id` |
| `DELETE` | `/academic/chapters/:id` |
| `POST` | `/academic/topics` |
| `GET` | `/academic/chapters/:chapterId/topics` |
| `GET` | `/academic/topics/:id` |
| `PATCH` | `/academic/topics/:id` |
| `DELETE` | `/academic/topics/:id` |
| `POST` | `/academic/sub-topics` |
| `GET` | `/academic/topics/:topicId/sub-topics` |
| `GET` | `/academic/sub-topics/:id` |
| `PATCH` | `/academic/sub-topics/:id` |
| `DELETE` | `/academic/sub-topics/:id` |

### ADMIN (60 endpoints)
| Method | Route Path |
|---|---|
| `POST` | `/admin` |
| `GET` | `/admin` |
| `GET` | `/admin/:id` |
| `PATCH` | `/admin/:id` |
| `DELETE` | `/admin/:id` |
| `GET` | `/admin/approvals` |
| `GET` | `/admin/approvals/:id` |
| `POST` | `/admin/approvals/submit` |
| `POST` | `/admin/approvals/:id/approve` |
| `POST` | `/admin/approvals/:id/reject` |
| `POST` | `/admin/approvals/:id/cancel` |
| `POST` | `/admin/approvals/bulk-approve` |
| `GET` | `/admin/audit-logs` |
| `GET` | `/admin/audit-logs/:id` |
| `GET` | `/admin/dashboard` |
| `POST` | `/admin/exams/:examId/activate` |
| `POST` | `/admin/exams/:examId/deactivate` |
| `POST` | `/admin/exams/bulk-activate` |
| `GET` | `/admin/students/bulk-template` |
| `POST` | `/admin/students/bulk-upload` |
| `GET` | `/admin/students/bulk-uploads` |
| `GET` | `/admin/students/bulk-upload/:id/preview` |
| `POST` | `/admin/students/bulk-upload/:id/confirm` |
| `GET` | `/admin/students/bulk-upload/:id/error-report` |
| `GET` | `/admin/students` |
| `GET` | `/admin/students/filter-options` |
| `GET` | `/admin/students/:studentId/parents` |
| `POST` | `/admin/students/:studentId/parents` |
| `DELETE` | `/admin/students/:studentId/parents/:linkId` |
| `GET` | `/admin/users` |
| `GET` | `/admin/completed-exams` |
| `GET` | `/super-admin/completed-exams` |
| `GET` | `/admin/completed-exams/latest` |
| `GET` | `/super-admin/completed-exams/latest` |
| `GET` | `/admin/completed-exams/:examId/summary` |
| `GET` | `/super-admin/completed-exams/:examId/summary` |
| `GET` | `/` |
| `GET` | `/admin/completed-exams/:examId/attendees` |
| `GET` | `/super-admin/completed-exams/:examId/attendees` |
| `GET` | `/` |
| `GET` | `/admin/completed-exams/:examId/attendees/:attemptId/analysis` |
| `GET` | `/super-admin/completed-exams/:examId/attendees/:attemptId/analysis` |
| `GET` | `/` |
| `POST` | `/admin/completed-exams/:examId/attempts/:attemptId/send-report` |
| `POST` | `/super-admin/completed-exams/:examId/attempts/:attemptId/send-report` |
| `POST` | `/` |
| `GET` | `/admin/completed-exams/:examId/attempts/:attemptId/email-status` |
| `GET` | `/super-admin/completed-exams/:examId/attempts/:attemptId/email-status` |
| `GET` | `/` |
| `GET` | `/super-admin/dashboard/overview` |
| `GET` | `/super-admin/dashboard/daily-registrations` |
| `GET` | `/super-admin/dashboard/state-registrations` |
| `GET` | `/super-admin/dashboard/district-registrations` |
| `GET` | `/super-admin/dashboard/institution-registrations` |
| `GET` | `/super-admin/dashboard/exam-targets` |
| `GET` | `/super-admin/dashboard/language-preferences` |
| `GET` | `/super-admin/dashboard/revenue` |
| `GET` | `/super-admin/dashboard/conversion-rate` |
| `GET` | `/super-admin/dashboard/sales-agent-performance` |
| `GET` | `/super-admin/dashboard/filters-metadata` |

### ATTEMPT-STRATEGY (9 endpoints)
| Method | Route Path |
|---|---|
| `GET` | `/attempts/:attemptId/strategy` |
| `GET` | `/attempts/:attemptId/strategy/metrics` |
| `GET` | `/attempts/:attemptId/strategy/recommendations` |
| `POST` | `/attempts/:attemptId/strategy/recalculate` |
| `POST` | `/analysis/strategy-rules` |
| `GET` | `/analysis/strategy-rules` |
| `GET` | `/analysis/strategy-rules/:id` |
| `PATCH` | `/analysis/strategy-rules/:id` |
| `DELETE` | `/analysis/strategy-rules/:id` |

### AUTH (20 endpoints)
| Method | Route Path |
|---|---|
| `POST` | `/auth/register/send-otp` |
| `POST` | `/auth/register/verify-otp` |
| `POST` | `/auth/register` |
| `POST` | `/auth/verify-registration-otp` |
| `POST` | `/auth/login/send-otp` |
| `POST` | `/auth/login/verify-otp` |
| `POST` | `/auth/login/request-otp` |
| `POST` | `/auth/otp/resend` |
| `POST` | `/auth/otp/request` |
| `POST` | `/auth/otp/verify` |
| `POST` | `/auth/login/email` |
| `POST` | `/auth/login/student-id` |
| `POST` | `/auth/google` |
| `POST` | `/auth/refresh` |
| `POST` | `/auth/logout` |
| `POST` | `/auth/logout-all` |
| `GET` | `/auth/sessions` |
| `DELETE` | `/auth/sessions/:id` |
| `GET` | `/auth/me` |
| `GET` | `/auth/options` |

### EXAM (33 endpoints)
| Method | Route Path |
|---|---|
| `GET` | `/admin/exam-manager/blueprints` |
| `POST` | `/admin/exam-manager/validate` |
| `POST` | `/admin/exam-manager/create-from-upload` |
| `GET` | `/admin/exam-manager/template` |
| `POST` | `/admin/exam-manager/import` |
| `GET` | `/admin/exam-manager/import/:importId` |
| `GET` | `/admin/exam-manager/import/:importId/rows` |
| `GET` | `/admin/exam-manager/import-history` |
| `GET` | `/admin/exam-manager/import/:importId/errors/export` |
| `GET` | `/admin/exam-manager/exams` |
| `GET` | `/admin/exam-manager/exams/:id` |
| `GET` | `/public/exams` |
| `GET` | `/public/exams/:id` |
| `POST` | `/exams/validate-generation-filters` |
| `POST` | `/exams/preview-generation` |
| `POST` | `/exams/generate-from-filters` |
| `POST` | `/exams/generate-from-import/:importId` |
| `POST` | `/exams` |
| `POST` | `/exams/create-from-template` |
| `POST` | `/exams/generate-questions` |
| `POST` | `/exams/add-questions` |
| `PATCH` | `/exams/:id/submit` |
| `PATCH` | `/exams/:id/approve` |
| `PATCH` | `/exams/:id/activate` |
| `PATCH` | `/exams/:id/complete` |
| `PATCH` | `/exams/:id/cancel` |
| `GET` | `/exams` |
| `GET` | `/exams/available/:examTargetId` |
| `GET` | `/exams/:id/available-languages` |
| `GET` | `/exams/:id/details` |
| `GET` | `/exams/:id` |
| `PATCH` | `/exams/:id` |
| `DELETE` | `/exams/:id` |

### EXAM-ATTEMPT (12 endpoints)
| Method | Route Path |
|---|---|
| `POST` | `/attempts/start` |
| `PUT` | `/attempts/:id/answer` |
| `PUT` | `/attempts/:id/answers` |
| `POST` | `/attempts/:id/time-log` |
| `POST` | `/attempts/:id/submit` |
| `POST` | `/attempts/:id/leave` |
| `POST` | `/attempts/:id/auto-submit` |
| `PUT` | `/attempts/:id/language` |
| `PATCH` | `/attempts/:id/language` |
| `GET` | `/attempts/:id/status` |
| `GET` | `/attempts/:id/questions` |
| `GET` | `/attempts/my-history` |

### EXAM-GENERATOR (18 endpoints)
| Method | Route Path |
|---|---|
| `POST` | `/exams/:examId/blueprints` |
| `GET` | `/exams/:examId/blueprints` |
| `GET` | `/blueprints/:id` |
| `PATCH` | `/blueprints/:id` |
| `DELETE` | `/blueprints/:id` |
| `POST` | `/blueprints/:blueprintId/rules` |
| `PATCH` | `/blueprints/rules/:ruleId` |
| `DELETE` | `/blueprints/rules/:ruleId` |
| `POST` | `/blueprints/:blueprintId/validate` |
| `POST` | `/blueprints/:blueprintId/generate` |
| `GET` | `/exams/:examId/versions` |
| `GET` | `/exam-versions/:versionId` |
| `POST` | `/exam-versions/:versionId/publish` |
| `GET` | `/exam-versions/:versionId/questions` |
| `GET` | `/admin/exams/subject-wise/stats` |
| `GET` | `/admin/exams/subject-wise/template` |
| `POST` | `/admin/exams/subject-wise/upload` |
| `POST` | `/admin/exams/subject-wise/generate` |

### EXAM-SCHEDULING (23 endpoints)
| Method | Route Path |
|---|---|
| `GET` | `/exam-calendar` |
| `POST` | `/exam-calendar` |
| `PATCH` | `/exam-calendar/:id/reschedule` |
| `GET` | `/exam-cycles` |
| `GET` | `/exam-cycles/:id` |
| `POST` | `/exam-cycles` |
| `PATCH` | `/exam-cycles/:id` |
| `POST` | `/exams/:examId/submit` |
| `POST` | `/exams/:examId/approve` |
| `POST` | `/exams/:examId/reject` |
| `POST` | `/exams/:examId/schedule` |
| `PATCH` | `/exam-schedules/:scheduleId` |
| `POST` | `/exam-schedules/:scheduleId/activate` |
| `POST` | `/exams/:examId/cancel` |
| `GET` | `/exams/:examId/lifecycle` |
| `GET` | `/exams/:examId/schedule` |
| `GET` | `/exams/:examId/access-check` |
| `GET` | `/super-admin/exams/scheduling-candidates` |
| `GET` | `/exams/scheduling-candidates` |
| `POST` | `/super-admin/exams/:examId/activate` |
| `POST` | `/exams/:examId/activate` |
| `GET` | `/admin/feature-activations` |
| `POST` | `/admin/feature-activations` |

### EXAM-SECURITY (12 endpoints)
| Method | Route Path |
|---|---|
| `GET` | `/admin/security-profiles` |
| `GET` | `/admin/exams/:examId/security-summary` |
| `GET` | `/admin/attempts/:attemptId/security` |
| `POST` | `/admin/attempts/:attemptId/security-review` |
| `POST` | `/admin/attempts/:attemptId/terminate` |
| `GET` | `/exams/:examId/security-preflight` |
| `POST` | `/attempts/:attemptId/accept-policy` |
| `POST` | `/attempts/:attemptId/session` |
| `POST` | `/attempts/:attemptId/heartbeat` |
| `POST` | `/attempts/:attemptId/security-events` |
| `GET` | `/attempts/:attemptId/security-status` |
| `GET` | `/attempts/:attemptId/security-events` |

### FEATURE-FLAG (1 endpoints)
| Method | Route Path |
|---|---|
| `GET` | `/config/features` |

### HEALTH (12 endpoints)
| Method | Route Path |
|---|---|
| `GET` | `/health` |
| `GET` | `/health/status` |
| `GET` | `/status` |
| `GET` | `/status/status` |
| `GET` | `/` |
| `GET` | `/status` |
| `GET` | `/health/live` |
| `GET` | `/status/live` |
| `GET` | `/live` |
| `GET` | `/health/ready` |
| `GET` | `/status/ready` |
| `GET` | `/ready` |

### INSTITUTION (27 endpoints)
| Method | Route Path |
|---|---|
| `POST` | `/institutions/me/bulk-uploads` |
| `GET` | `/institutions/me/bulk-uploads` |
| `GET` | `/institutions/me/bulk-uploads/:uploadId` |
| `GET` | `/institutions/me/bulk-uploads/:uploadId/preview` |
| `GET` | `/institutions/me/bulk-uploads/:uploadId/errors` |
| `POST` | `/institutions/me/bulk-uploads/:uploadId/submit` |
| `POST` | `/institutions/me/bulk-uploads/:uploadId/review` |
| `GET` | `/institutions/me/batches` |
| `POST` | `/institutions/me/batches` |
| `GET` | `/institutions/me/batches/:batchId` |
| `PATCH` | `/institutions/me/batches/:batchId` |
| `GET` | `/institutions/me/batches/:batchId/students` |
| `POST` | `/institutions/me/batches/:batchId/students` |
| `DELETE` | `/institutions/me/batches/:batchId/students/:studentId` |
| `GET` | `/institutions/me/dashboard` |
| `GET` | `/institutions/me/batches/:batchId/analytics` |
| `GET` | `/institutions/me` |
| `PATCH` | `/institutions/me` |
| `POST` | `/institutions` |
| `GET` | `/institutions` |
| `GET` | `/institutions/:id` |
| `PATCH` | `/institutions/:id/status` |
| `POST` | `/institutions/:id/admins` |
| `POST` | `/institutions/me/reports` |
| `GET` | `/institutions/me/reports` |
| `GET` | `/institutions/me/reports/:reportJobId` |
| `GET` | `/institutions/me/reports/download-local/:fileName` |

### NOTIFICATION (10 endpoints)
| Method | Route Path |
|---|---|
| `GET` | `/admin/notifications` |
| `GET` | `/admin/notifications/templates` |
| `POST` | `/admin/notifications/templates` |
| `GET` | `/notifications` |
| `GET` | `/notifications/unread-count` |
| `PATCH` | `/notifications/read-all` |
| `PATCH` | `/notifications/:id/read` |
| `DELETE` | `/notifications/:id` |
| `GET` | `/notifications/preferences` |
| `PATCH` | `/notifications/preferences` |

### PARENT-DASHBOARD (7 endpoints)
| Method | Route Path |
|---|---|
| `GET` | `/parents/me/students` |
| `GET` | `/parents/me/dashboard` |
| `GET` | `/parents/me/students/:studentId/dashboard` |
| `GET` | `/parents/me/students/:studentId/trends` |
| `GET` | `/parents/me/students/:studentId/subjects` |
| `GET` | `/parents/me/students/:studentId/rank` |
| `GET` | `/parents/me/students/:studentId/recommendations` |

### PERFORMANCE-TREND (5 endpoints)
| Method | Route Path |
|---|---|
| `GET` | `/students/:studentId/analytics/trends` |
| `GET` | `/students/me/analytics/trends` |
| `GET` | `/students/me/analytics/compare` |
| `GET` | `/students/me/dashboard` |
| `GET` | `/students/me/analytics/comparison` |

### PREDICTED-RANK (9 endpoints)
| Method | Route Path |
|---|---|
| `POST` | `/prediction/historical-exams` |
| `GET` | `/prediction/historical-exams` |
| `GET` | `/prediction/historical-exams/:id` |
| `POST` | `/prediction/historical-exams/:id/dataset` |
| `POST` | `/prediction/historical-exams/:id/validate` |
| `POST` | `/prediction/evaluations/exam/:examId` |
| `GET` | `/prediction/evaluation/summary` |
| `GET` | `/attempts/:attemptId/predicted-rank` |
| `POST` | `/attempts/:attemptId/predicted-rank/generate` |

### QUESTION-BANK (22 endpoints)
| Method | Route Path |
|---|---|
| `GET` | `/questions/import/template` |
| `POST` | `/questions/import` |
| `GET` | `/questions/import/:importId` |
| `GET` | `/questions/import/:importId/rows` |
| `PATCH` | `/questions/import/:importId/rows/:rowId` |
| `POST` | `/questions/import/:importId/confirm` |
| `POST` | `/questions/import/:importId/cancel` |
| `GET` | `/questions/import/:importId/errors/export` |
| `POST` | `/questions` |
| `GET` | `/questions` |
| `GET` | `/questions/stats` |
| `GET` | `/questions/stats/:examTargetId` |
| `GET` | `/questions/:id` |
| `GET` | `/questions/:id/history` |
| `GET` | `/questions/:id/versions` |
| `PATCH` | `/questions/:id` |
| `POST` | `/questions/:id/submit` |
| `POST` | `/questions/:id/start-review` |
| `POST` | `/questions/:id/approve` |
| `POST` | `/questions/:id/reject` |
| `POST` | `/questions/:id/archive` |
| `DELETE` | `/questions/:id` |

### RANK-ENGINE (5 endpoints)
| Method | Route Path |
|---|---|
| `POST` | `/exams/:examId/ranks/generate` |
| `GET` | `/exams/:examId/ranks/status` |
| `GET` | `/exams/:examId/ranks/leaderboard` |
| `GET` | `/attempts/:attemptId/ranks` |
| `GET` | `/attempts/:attemptId/rank-prediction` |

### REGIONAL-LANGUAGE (29 endpoints)
| Method | Route Path |
|---|---|
| `GET` | `/exams/:examId/languages` |
| `PUT` | `/exams/:examId/languages` |
| `GET` | `/exams/:examId/translations/coverage` |
| `GET` | `/exams/:examId/translations/template` |
| `GET` | `/exams/:examId/translations/export` |
| `POST` | `/exams/:examId/translations/validate` |
| `POST` | `/exams/:examId/translations/import` |
| `POST` | `/exams/:examId/translations/upload` |
| `GET` | `/languages` |
| `GET` | `/languages/:id` |
| `POST` | `/languages` |
| `PATCH` | `/languages/:id` |
| `DELETE` | `/languages/:id` |
| `GET` | `/translations/targets` |
| `GET` | `/admin/translations/targets` |
| `GET` | `/translations/import/template` |
| `POST` | `/translations/import` |
| `GET` | `/translations/import/:importId` |
| `GET` | `/translations/import/:importId/rows` |
| `PATCH` | `/translations/import/:importId/rows/:rowId` |
| `POST` | `/translations/import/:importId/confirm` |
| `POST` | `/translations/import/:importId/cancel` |
| `GET` | `/translations/import/:importId/errors/export` |
| `GET` | `/translations/completeness/:questionId` |
| `GET` | `/translations/question/:questionId` |
| `POST` | `/translations/question/:questionId` |
| `POST` | `/translations/question/:questionId/full` |
| `DELETE` | `/translations/question/:questionId/:languageId` |
| `POST` | `/translations/option/:optionId` |

### RESULT (28 endpoints)
| Method | Route Path |
|---|---|
| `GET` | `/admin/exams/results/publication-dashboard` |
| `GET` | `/super-admin/exams/:examId/results/preview` |
| `GET` | `/admin/exams/:examId/results/preview` |
| `GET` | `/super-admin/exams/:examId/results/readiness` |
| `GET` | `/admin/exams/:examId/results/readiness` |
| `GET` | `/` |
| `POST` | `/super-admin/exams/:examId/results/publish` |
| `POST` | `/admin/exams/:examId/results/publish` |
| `POST` | `/` |
| `POST` | `/results/:attemptId/calculate` |
| `POST` | `/results/:attemptId/recalculate` |
| `GET` | `/results/:attemptId/status` |
| `GET` | `/students/me/results/:attemptId/status` |
| `GET` | `/results/:attemptId/verify` |
| `GET` | `/students/me/results/:attemptId/verify` |
| `GET` | `/results/:attemptId` |
| `GET` | `/students/me/results/:attemptId` |
| `GET` | `/results/:attemptId/analysis` |
| `GET` | `/students/me/results/:attemptId/analysis` |
| `GET` | `/results/:attemptId/subjects` |
| `GET` | `/results/:attemptId/chapters` |
| `GET` | `/results/:attemptId/time-analysis` |
| `GET` | `/results/:attemptId/strategy` |
| `GET` | `/results/:attemptId/recommendations` |
| `GET` | `/results/:attemptId/review` |
| `GET` | `/admin/exams/:examId/results/processing-status` |
| `GET` | `/super-admin/exams/:examId/results/processing-status` |
| `GET` | `/` |

### STUDENT (19 endpoints)
| Method | Route Path |
|---|---|
| `GET` | `/students/me/exams` |
| `GET` | `/students/student/exams` |
| `GET` | `/students/me/mock-tests` |
| `GET` | `/students/student/mock-tests` |
| `GET` | `/students/me/mock-history` |
| `GET` | `/students/student/mock-history` |
| `GET` | `/students/me/mock-tests/:mockTestId/attempts` |
| `GET` | `/students/me/exams/:mockTestId/attempts` |
| `GET` | `/students/me` |
| `GET` | `/students/me/profile` |
| `PATCH` | `/students/me` |
| `PATCH` | `/students/me/profile` |
| `POST` | `/students/me/mobile/request-otp` |
| `PATCH` | `/students/me/mobile` |
| `POST` | `/students/me/mobile/verify-otp` |
| `POST` | `/students/me/email/request-otp` |
| `PATCH` | `/students/me/email` |
| `POST` | `/students/me/email/verify-otp` |
| `GET` | `/students/me/sessions` |

### TIME-ANALYSIS (9 endpoints)
| Method | Route Path |
|---|---|
| `POST` | `/attempts/:attemptId/questions/:questionId/time/start` |
| `POST` | `/attempts/:attemptId/questions/:questionId/time/end` |
| `GET` | `/attempts/:attemptId/time/active` |
| `GET` | `/attempts/:attemptId/analysis/time` |
| `GET` | `/attempts/:attemptId/analysis/time/summary` |
| `GET` | `/attempts/:attemptId/analysis/time/questions/:questionId` |
| `GET` | `/attempts/:attemptId/analysis/time/subjects` |
| `GET` | `/attempts/:attemptId/analysis/time/chapters` |
| `POST` | `/attempts/:attemptId/analysis/time/recalculate` |

