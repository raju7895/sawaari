/* Supabase Storage.
 *
 *   avatars          public   — profile photos, read by everyone
 *   driver-documents private  — licences and papers: the owner and admins only
 */
import { supabase } from './supabase';

const MAX_BYTES = 8 * 1024 * 1024;               // 8 MB
const ALLOWED = {
  avatars: ['image/'],
  'driver-documents': ['image/', 'application/pdf'],
};

/** Uploads a file under the user's own folder and returns the path. */
export async function uploadFile(bucket, file, path) {
  if (!file) throw new Error('No file selected.');
  if (file.size > MAX_BYTES) {
    throw new Error(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 8 MB.`);
  }
  const allowed = ALLOWED[bucket] || [];
  if (allowed.length && !allowed.some((p) => file.type.startsWith(p))) {
    throw new Error(`That file type (${file.type || 'unknown'}) is not allowed here.`);
  }
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: '3600',
    upsert: true,
    contentType: file.type || 'application/octet-stream',
  });
  if (error) throw new Error(error.message || 'The upload failed. Please try again.');
  return path;
}

/** The public URL of a file in a public bucket. */
export function publicUrl(bucket, path) {
  if (!path) return null;
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data?.publicUrl || null;
}

/** A temporary signed URL for a private file (never store it). */
export async function signedUrl(bucket, path, seconds = 300) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, seconds);
  if (error) throw new Error(error.message || 'That file could not be opened.');
  return data?.signedUrl || null;
}

export async function removeFile(bucket, path) {
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) throw new Error(error.message || 'The file could not be deleted.');
  return true;
}
