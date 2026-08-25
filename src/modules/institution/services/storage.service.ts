import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private s3Client: S3Client | null = null;
  private bucketName: string;
  private localDir: string;
  private useLocalFallback = false;

  constructor(private readonly config: ConfigService) {
    this.bucketName = this.config.get<string>('S3_BUCKET') || 'brainros-reports';
    const s3Endpoint = this.config.get<string>('S3_ENDPOINT');
    const accessKey = this.config.get<string>('S3_ACCESS_KEY');
    const secretKey = this.config.get<string>('S3_SECRET_KEY');
    const region = this.config.get<string>('S3_REGION') || 'us-east-1';

    this.localDir = path.resolve(process.cwd(), 'storage', 'reports');

    if (accessKey && secretKey) {
      try {
        this.s3Client = new S3Client({
          region,
          endpoint: s3Endpoint || undefined,
          credentials: {
            accessKeyId: accessKey,
            secretAccessKey: secretKey,
          },
          forcePathStyle: true,
        });
      } catch (err) {
        this.logger.warn(`Failed to initialize S3 client: ${err.message}. Using local storage fallback.`);
        this.useLocalFallback = true;
      }
    } else {
      this.logger.log('S3 credentials not configured. Using local filesystem storage fallback.');
      this.useLocalFallback = true;
    }

    if (!fs.existsSync(this.localDir)) {
      fs.mkdirSync(this.localDir, { recursive: true });
    }
  }

  /**
   * Upload a file buffer to storage.
   * Returns storage key.
   */
  async uploadFile(key: string, buffer: Buffer, contentType: string): Promise<string> {
    if (!this.useLocalFallback && this.s3Client) {
      try {
        await this.s3Client.send(
          new PutObjectCommand({
            Bucket: this.bucketName,
            Key: key,
            Body: buffer,
            ContentType: contentType,
          }),
        );
        return key;
      } catch (err) {
        this.logger.warn(`S3 upload failed: ${err.message}. Falling back to local storage.`);
        this.useLocalFallback = true;
      }
    }

    // Local filesystem storage
    const filePath = path.join(this.localDir, path.basename(key));
    await fs.promises.writeFile(filePath, buffer);
    return key;
  }

  /**
   * Generate a signed or temporary download URL (valid for 1 hour by default).
   */
  async getDownloadUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    if (!this.useLocalFallback && this.s3Client) {
      try {
        const command = new GetObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        });
        return await getSignedUrl(this.s3Client, command, { expiresIn: expiresInSeconds });
      } catch (err) {
        this.logger.warn(`Failed to generate S3 presigned URL: ${err.message}`);
      }
    }

    // Local fallback download endpoint URL
    const appUrl = this.config.get<string>('APP_URL') || 'http://localhost:3000';
    return `${appUrl}/api/v1/institutions/me/reports/download-local/${encodeURIComponent(path.basename(key))}`;
  }

  /**
   * Get local file buffer if needed for local downloads.
   */
  async getLocalFile(fileName: string): Promise<Buffer | null> {
    const filePath = path.join(this.localDir, path.basename(fileName));
    if (fs.existsSync(filePath)) {
      return fs.promises.readFile(filePath);
    }
    return null;
  }
}
