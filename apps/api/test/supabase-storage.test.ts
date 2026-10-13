// apps/api/test/supabase-storage.test.ts
import { describe, expect, it, vi } from 'vitest';
import { EnvironmentService } from '../src/config/environment.service.js';
import { SupabaseObjectStorage } from '../src/integrations/supabase-storage.service.js';

describe('SupabaseObjectStorage', () => {
  const mockEnv = (overrides: Record<string, string> = {}) => {
    return {
      values: {
        STORAGE_PROVIDER: 'supabase',
        SUPABASE_URL: 'https://test.supabase.co',
        SUPABASE_SECRET_KEY: 'test-secret-key',
        SUPABASE_STORAGE_BUCKET: 'verification-documents',
        STORAGE_BUCKETS: ['evidence', 'documents', 'recordings', 'reports'],
        ...overrides
      }
    } as unknown as EnvironmentService;
  };

  it('fails fast if methods are invoked without Supabase credentials', async () => {
    const emptyEnv = {
      values: {
        STORAGE_PROVIDER: 'mock',
        STORAGE_BUCKETS: ['evidence', 'documents']
      }
    } as unknown as EnvironmentService;

    const storage = new SupabaseObjectStorage(emptyEnv);
    await expect(storage.put({ key: 'test.jpg', bucket: 'documents', content: new Uint8Array(), contentType: 'image/jpeg' }))
      .rejects.toThrow('SupabaseObjectStorage requires SUPABASE_URL and SUPABASE_SECRET_KEY');
  });

  it('routes "documents" bucket to configured SUPABASE_STORAGE_BUCKET', async () => {
    const storage = new SupabaseObjectStorage(mockEnv({ SUPABASE_STORAGE_BUCKET: 'custom-verification-bucket' }));
    const client = (storage as unknown as { getClient: () => { storage: { from: (b: string) => Record<string, unknown> } } }).getClient();
    const uploadMock = vi.fn().mockResolvedValue({ error: null });
    const fromSpy = vi.spyOn(client.storage, 'from').mockReturnValue({
      upload: uploadMock
    });

    await storage.put({ key: 'user1/CNIC_FRONT/id.jpg', bucket: 'documents', content: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' });
    expect(fromSpy).toHaveBeenCalledWith('custom-verification-bucket');
  });

  it('routes "evidence" bucket directly to "evidence"', async () => {
    const storage = new SupabaseObjectStorage(mockEnv());
    const client = (storage as unknown as { getClient: () => { storage: { from: (b: string) => Record<string, unknown> } } }).getClient();
    const uploadMock = vi.fn().mockResolvedValue({ error: null });
    const fromSpy = vi.spyOn(client.storage, 'from').mockReturnValue({
      upload: uploadMock
    });

    await storage.put({ key: 'booking1/item.mp4', bucket: 'evidence', content: new Uint8Array([1, 2, 3]), contentType: 'video/mp4' });
    expect(fromSpy).toHaveBeenCalledWith('evidence');
  });

  it('handles get returning file content and contentType', async () => {
    const storage = new SupabaseObjectStorage(mockEnv());
    const client = (storage as unknown as { getClient: () => { storage: { from: (b: string) => Record<string, unknown> } } }).getClient();

    const fakeBlob = new Blob(['sample-data'], { type: 'application/pdf' });
    vi.spyOn(client.storage, 'from').mockReturnValue({
      download: vi.fn().mockResolvedValue({ data: fakeBlob, error: null })
    });

    const result = await storage.get({ key: 'doc.pdf', bucket: 'documents' });
    expect(result).not.toBeNull();
    expect(result?.contentType).toBe('application/pdf');
    expect(result?.content.toString()).toBe('sample-data');
  });

  it('handles get returning null on download error', async () => {
    const storage = new SupabaseObjectStorage(mockEnv());
    const client = (storage as unknown as { getClient: () => { storage: { from: (b: string) => Record<string, unknown> } } }).getClient();

    vi.spyOn(client.storage, 'from').mockReturnValue({
      download: vi.fn().mockResolvedValue({ data: null, error: new Error('NoSuchKey') })
    });

    const result = await storage.get({ key: 'missing.pdf', bucket: 'documents' });
    expect(result).toBeNull();
  });

  it('creates signed upload URLs via presignPut', async () => {
    const storage = new SupabaseObjectStorage(mockEnv());
    const client = (storage as unknown as { getClient: () => { storage: { from: (b: string) => Record<string, unknown> } } }).getClient();

    vi.spyOn(client.storage, 'from').mockReturnValue({
      createSignedUploadUrl: vi.fn().mockResolvedValue({
        data: { signedUrl: 'https://test.supabase.co/upload/signed?token=abc' },
        error: null
      })
    });

    const res = await storage.presignPut({
      key: 'user/CNIC_BACK/123.png',
      bucket: 'documents',
      contentType: 'image/png',
      maxBytes: 5242880
    });

    expect(res.method).toBe('PUT');
    expect(res.url).toBe('https://test.supabase.co/upload/signed?token=abc');
    expect(new Date(res.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('creates signed download URLs via presignGet', async () => {
    const storage = new SupabaseObjectStorage(mockEnv());
    const client = (storage as unknown as { getClient: () => { storage: { from: (b: string) => Record<string, unknown> } } }).getClient();

    vi.spyOn(client.storage, 'from').mockReturnValue({
      createSignedUrl: vi.fn().mockResolvedValue({
        data: { signedUrl: 'https://test.supabase.co/object/sign/doc.pdf?token=xyz' },
        error: null
      })
    });

    const res = await storage.presignGet({ key: 'doc.pdf', bucket: 'documents', ttlSeconds: 300 });
    expect(res.url).toBe('https://test.supabase.co/object/sign/doc.pdf?token=xyz');
  });

  it('inspects object existence and size via head', async () => {
    const storage = new SupabaseObjectStorage(mockEnv());
    const client = (storage as unknown as { getClient: () => { storage: { from: (b: string) => Record<string, unknown> } } }).getClient();

    vi.spyOn(client.storage, 'from').mockReturnValue({
      list: vi.fn().mockResolvedValue({
        data: [
          {
            name: 'photo.jpg',
            metadata: { size: 1024, mimetype: 'image/jpeg' }
          }
        ],
        error: null
      })
    });

    const res = await storage.head({ key: 'folder/subfolder/photo.jpg', bucket: 'evidence' });
    expect(res).toEqual({ size: 1024, contentType: 'image/jpeg' });
  });

  it('removes objects via remove', async () => {
    const storage = new SupabaseObjectStorage(mockEnv());
    const client = (storage as unknown as { getClient: () => { storage: { from: (b: string) => Record<string, unknown> } } }).getClient();

    const removeFn = vi.fn().mockResolvedValue({ error: null });
    vi.spyOn(client.storage, 'from').mockReturnValue({
      remove: removeFn
    });

    await storage.remove({ key: 'old-doc.pdf', bucket: 'documents' });
    expect(removeFn).toHaveBeenCalledWith(['old-doc.pdf']);
  });
});
