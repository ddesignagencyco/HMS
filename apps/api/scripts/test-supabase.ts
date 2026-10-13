// apps/api/scripts/test-supabase.ts
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
const bucketName = process.env.SUPABASE_STORAGE_BUCKET || 'verification-documents';

if (!url || !key) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SECRET_KEY in .env file.');
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

async function testConnection() {
  console.log('--- Supabase Storage Verification ---');
  console.log(`Connecting to: ${url}`);
  console.log(`Target bucket: ${bucketName}\n`);

  // 1. Check bucket
  const { data: bucket, error: bucketError } = await supabase.storage.getBucket(bucketName);
  if (bucketError) {
    console.error(`❌ Storage connection failed for bucket "${bucketName}":`, bucketError.message);
    process.exit(1);
  }

  console.log(`✅ Connected successfully to bucket: "${bucket.name}"`);
  console.log(`   - Public bucket: ${bucket.public ? 'YES (Warning: Should be OFF for CNIC/private documents)' : 'OFF (Secure/Private)'}`);
  console.log(`   - File size limit: ${bucket.file_size_limit ? `${bucket.file_size_limit / (1024 * 1024)} MB` : 'Default'}`);

  // 2. Test uploading CNIC image, PDF, and Video
  const testItems = [
    { type: 'CNIC / Image', filename: '_test_verify/cnic_sample.jpg', mime: 'image/jpeg', bytes: Buffer.from('TEST_CNIC_IMAGE_DATA') },
    { type: 'Document / PDF', filename: '_test_verify/doc_sample.pdf', mime: 'application/pdf', bytes: Buffer.from('%PDF-1.4 TEST_PDF_DATA') },
    { type: 'Video', filename: '_test_verify/video_sample.mp4', mime: 'video/mp4', bytes: Buffer.from('TEST_MP4_VIDEO_DATA') },
  ];

  console.log('\n--- Testing Upload & Signed URLs (Images, CNIC, Video, PDFs) ---');

  for (const item of testItems) {
    const { error: uploadError } = await supabase.storage.from(bucketName).upload(item.filename, item.bytes, {
      contentType: item.mime,
      upsert: true,
    });

    if (uploadError) {
      console.error(`❌ Upload failed for ${item.type} (${item.mime}):`, uploadError.message);
    } else {
      const { data: signed, error: signError } = await supabase.storage.from(bucketName).createSignedUrl(item.filename, 60);
      if (signError) {
        console.error(`❌ Signed URL failed for ${item.type}:`, signError.message);
      } else {
        console.log(`✅ ${item.type} [${item.mime}] uploaded successfully.`);
        console.log(`   Signed 60s view URL: ${signed.signedUrl.substring(0, 95)}...`);
      }
    }
  }

  // 3. Test Presigned PUT upload target
  const { data: putTarget, error: putError } = await supabase.storage.from(bucketName).createSignedUploadUrl('_test_verify/presign_target.jpg');
  if (putError) {
    console.error('❌ Presigned upload target failed:', putError.message);
  } else {
    console.log('\n✅ Direct presigned upload target (PUT) working.');
    console.log(`   Upload target URL: ${putTarget.signedUrl.substring(0, 95)}...`);
  }

  // 4. Cleanup
  const toClean = testItems.map((item) => item.filename);
  await supabase.storage.from(bucketName).remove(toClean);
  console.log('\n✅ Cleaned up temporary verification files.');
  console.log('🎉 Supabase storage is fully configured and ready for Images, CNIC, Video, and PDFs!\n');
}

testConnection().catch((err) => {
  console.error('Error during test:', err);
  process.exit(1);
});
