export interface ApiErrorResponse {
  success: boolean; // Always false
  statusCode: number;
  message: string;
  error: string;
  details?: unknown;
  timestamp: string;
  path: string;
  requestId?: string;
}
