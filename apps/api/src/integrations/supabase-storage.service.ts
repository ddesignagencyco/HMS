// apps/api/src/integrations/supabase-storage.service.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { EnvironmentService } from '../config/environment.service.js';
import type { ObjectStoragePort } from './ports.js';

@Injectable()
export class SupabaseObjectStorage implements ObjectStoragePort {
  private readonly logger = new Logger(SupabaseObjectStorage.name);
  private readonly client: SupabaseClient | null = null;
  private readonly defaultBucket: string;

  constructor(@Inject(EnvironmentService) private readonly environment: EnvironmentService) {
    const url = this.environment.values.SUPABASE_URL;
    const secretKey = this.environment.values.SUPABASE_SECRET_KEY;

    this.defaultBucket = this.environment.values.SUPABASE_STORAGE_BUCKET || 'verification-documents';

    if (url && secretKey) {
      this.client = createClient(url, secretKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      });
    }
  }

  private getClient(): SupabaseClient {
    if (!this.client) {
      throw new Error('SupabaseObjectStorage requires SUPABASE_URL and SUPABASE_SECRET_KEY to be configured in .env');
    }
    return this.client;
  }

  /**
   * Maps internal logical bucket names to target Supabase storage buckets.
   * By default, 'documents' routes to SUPABASE_STORAGE_BUCKET (e.g. 'verification-documents')
   * while other buckets ('evidence', 'recordings', 'reports') map to their respective bucket names.
   */
  private resolveBucket(bucket: string): string {
    if (bucket === 'documents') {
      return this.defaultBucket;
    }
    return bucket;
  }

  async put(input: { key: string; bucket: string; content: Uint8Array; contentType: string }): Promise<void> {
    const targetBucket = this.resolveBucket(input.bucket);
    const { error } = await this.getClient().storage
      .from(targetBucket)
      .upload(input.key, input.content, {
        contentType: input.contentType,
        upsert: true
      });

    if (error) {
      this.logger.error(`Supabase put failed for bucket ${targetBucket}, key ${input.key}: ${error.message}`);
      throw new Error(`Supabase storage upload failed: ${error.message}`);
    }
  }

  async get(input: { key: string; bucket: string }): Promise<{ content: Buffer; contentType: string } | null> {
    const targetBucket = this.resolveBucket(input.bucket);
    const { data, error } = await this.getClient().storage
      .from(targetBucket)
      .download(input.key);

    if (error || !data) {
      return null;
    }

    const arrayBuffer = await data.arrayBuffer();
    return {
      content: Buffer.from(arrayBuffer),
      contentType: data.type || 'application/octet-stream'
    };
  }

  async presignPut(input: { key: string; bucket: string; contentType: string; maxBytes: number }): Promise<{ url: string; method: 'PUT'; expiresAt: string }> {
    if (input.maxBytes < 1 || input.contentType.length === 0) {
      throw new Error('Upload policy is invalid');
    }

    const targetBucket = this.resolveBucket(input.bucket);
    const { data, error } = await this.getClient().storage
      .from(targetBucket)
      .createSignedUploadUrl(input.key, { upsert: true });

    if (error || !data?.signedUrl) {
      this.logger.error(`Supabase presignPut failed for bucket ${targetBucket}, key ${input.key}: ${error?.message}`);
      throw new Error(`Failed to create Supabase signed upload URL: ${error?.message ?? 'Unknown error'}`);
    }

    return {
      url: data.signedUrl,
      method: 'PUT',
      expiresAt: new Date(Date.now() + 300_000).toISOString()
    };
  }

  async presignGet(input: { key: string; bucket: string; ttlSeconds: number }): Promise<{ url: string; expiresAt: string }> {
    if (input.ttlSeconds < 1 || input.ttlSeconds > 900) {
      throw new Error('Signed download TTL must be between 1 and 900 seconds');
    }

    const targetBucket = this.resolveBucket(input.bucket);
    const { data, error } = await this.getClient().storage
      .from(targetBucket)
      .createSignedUrl(input.key, input.ttlSeconds);

    if (error || !data?.signedUrl) {
      this.logger.error(`Supabase presignGet failed for bucket ${targetBucket}, key ${input.key}: ${error?.message}`);
      throw new Error(`Failed to create Supabase signed download URL: ${error?.message ?? 'Object not found'}`);
    }

    return {
      url: data.signedUrl,
      expiresAt: new Date(Date.now() + input.ttlSeconds * 1_000).toISOString()
    };
  }

  async head(input: { key: string; bucket: string }): Promise<{ size: number; contentType: string } | null> {
    const targetBucket = this.resolveBucket(input.bucket);
    const parts = input.key.split('/');
    const fileName = parts.pop();
    const folder = parts.join('/');

    if (!fileName) {
      return null;
    }

    const { data, error } = await this.getClient().storage
      .from(targetBucket)
      .list(folder, { search: fileName, limit: 100 });

    if (error || !data || data.length === 0) {
      return null;
    }

    const item = data.find((entry) => entry.name === fileName);
    if (!item) {
      return null;
    }

    const metadata = item.metadata as { size?: number; mimetype?: string } | undefined;
    return {
      size: metadata?.size ?? 0,
      contentType: metadata?.mimetype ?? 'application/octet-stream'
    };
  }

  async remove(input: { key: string; bucket: string }): Promise<void> {
    const targetBucket = this.resolveBucket(input.bucket);
    const { error } = await this.getClient().storage
      .from(targetBucket)
      .remove([input.key]);

    if (error) {
      this.logger.error(`Supabase remove failed for bucket ${targetBucket}, key ${input.key}: ${error.message}`);
      throw new Error(`Supabase storage delete failed: ${error.message}`);
    }
  }

  /**
   * Diagnostic helper to verify bucket existence and connectivity.
   */
  async checkConnection(): Promise<{ bucket: string; accessible: boolean; error?: string }> {
    const { data, error } = await this.getClient().storage.getBucket(this.defaultBucket);
    if (error) {
      return { bucket: this.defaultBucket, accessible: false, error: error.message };
    }
    return { bucket: data.name, accessible: true };
  }
}
