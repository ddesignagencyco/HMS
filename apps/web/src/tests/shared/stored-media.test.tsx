import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StoredMedia, mediaKindOf, mediaLabels } from '@/components/evidence-image';
import { getDictionary } from '@/lib/dictionaries';

/* Stored files after the Supabase switch: real signed URLs load directly, the dev
   mock's JSON envelope is still unwrapped, and the element follows the type —
   evidence and documents may now be video or PDF as well as photos. */

const SIGNED = 'https://project.supabase.co/storage/v1/object/sign/evidence/b-1/u-1?token=abc';
const labels = mediaLabels(getDictionary('en'));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('StoredMedia', () => {
  it('loads a real signed URL directly, without fetching it first', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<StoredMedia url={SIGNED} contentType="image/jpeg" alt="Before" labels={labels} />);
    expect(screen.getByRole('img', { name: 'Before' }).getAttribute('src')).toBe(SIGNED);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders a video as a video, not a broken image', () => {
    const { container } = render(<StoredMedia url={SIGNED} contentType="video/mp4" alt="Walkthrough" labels={labels} />);
    expect(container.querySelector('video')?.getAttribute('src')).toBe(SIGNED);
    expect(container.querySelector('img')).toBeNull();
  });

  it('renders a PDF as a link that opens it', () => {
    render(<StoredMedia url={SIGNED} contentType="application/pdf" alt="Certificate" labels={labels} />);
    const link = screen.getByRole('link', { name: labels.openPdf });
    expect(link.getAttribute('href')).toBe(SIGNED);
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('says the file is unavailable when the link fails — an expired signature or a missing object', () => {
    render(<StoredMedia url={SIGNED} contentType="image/png" alt="After" labels={labels} />);
    fireEvent.error(screen.getByRole('img', { name: 'After' }));
    expect(screen.getByText(labels.unavailable)).toBeTruthy();
  });

  it('still unwraps the dev mock envelope, and takes the type from it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ contentType: 'image/png', contentBase64: 'AAAA' }), { status: 200, headers: { 'content-type': 'application/json' } }))
    );
    render(<StoredMedia url="/api/v1/dev/storage/evidence/b-1%2Fu-1" alt="Problem" labels={labels} />);
    await waitFor(() => expect(screen.getByRole('img', { name: 'Problem' }).getAttribute('src')).toBe('data:image/png;base64,AAAA'));
  });

  it('reports a dev URL the mock no longer holds (for example, after the API restarted on Supabase)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    render(<StoredMedia url="/api/v1/dev/storage/evidence/b-1%2Fu-1" alt="Problem" labels={labels} />);
    expect(await screen.findByText(labels.unavailable)).toBeTruthy();
  });
});

describe('mediaKindOf', () => {
  it('prefers the declared type and falls back to the extension', () => {
    expect(mediaKindOf('video/quicktime')).toBe('video');
    expect(mediaKindOf('application/pdf')).toBe('pdf');
    expect(mediaKindOf('image/gif')).toBe('image');
    expect(mediaKindOf(undefined, 'https://x.supabase.co/a/b/cert.PDF?token=1')).toBe('pdf');
    expect(mediaKindOf(null, 'https://x.supabase.co/a/b/clip.webm')).toBe('video');
    expect(mediaKindOf(undefined, SIGNED)).toBe('image');
  });
});
