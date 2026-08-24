export interface ApiResponse<T> {
  success: boolean;
  statusCode: number;
  message: string;
  data: T | null;
  meta?: Record<string, unknown> | null;
  timestamp: string;
  path: string;
  requestId?: string;
}
