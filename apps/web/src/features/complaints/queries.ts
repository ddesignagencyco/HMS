import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { complaintsApi, type ComplaintCreateInput } from '@/features/complaints/api';
import type { Locale } from '@/lib/utils';

/* Complaints — the customer's side of them and the provider's are the same
   endpoints, because `listMine` returns both what you raised and what was raised
   against you, and `viewFor` decides which side you are from your own id. */

export const complaintsKeys = {
  all: ['complaints'] as const,
  list: () => [...complaintsKeys.all, 'mine'] as const,
  detail: (id: string) => [...complaintsKeys.all, 'detail', id] as const
};

/** A 404 means "not yours" or "not there" — the API does not tell them apart. */
const notFound = (error: unknown): boolean => error instanceof Error && (error.message.includes('404') || error.name === 'NotFoundError');

const retryUnlessGone = (failureCount: number, error: unknown) => !notFound(error) && failureCount < 2;

/** `GET /complaints` — raised by you *and* raised against you, newest first. */
export const useMyComplaints = (locale: Locale) =>
  useQuery({
    queryKey: complaintsKeys.list(),
    queryFn: ({ signal }) => complaintsApi.listMine({ signal, locale }),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: retryUnlessGone
  });

/** `GET /complaints/:id` — the complaint plus its whole timeline. */
export const useComplaint = (id: string | null, locale: Locale) =>
  useQuery({
    queryKey: complaintsKeys.detail(id ?? ''),
    queryFn: ({ signal }) => complaintsApi.one(id as string, { signal, locale }),
    enabled: id !== null && id !== '',
    staleTime: 15_000,
    gcTime: 5 * 60_000,
    retry: retryUnlessGone
  });

/** `POST /complaints`. No retry: a duplicate complaint is worse than an error. */
export const useRaiseComplaint = (locale: Locale) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ComplaintCreateInput) => complaintsApi.create(input, { locale }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: complaintsKeys.all });
    },
    retry: false
  });
};

/** `POST /complaints/:id/reply` — a single call, no retry: it is a statement. */
export const useReplyToComplaint = (locale: Locale) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; body: string }) => complaintsApi.reply(input.id, input.body, { locale }),
    onSuccess: (_result, input) => {
      void queryClient.invalidateQueries({ queryKey: complaintsKeys.detail(input.id) });
      void queryClient.invalidateQueries({ queryKey: complaintsKeys.list() });
    },
    retry: false
  });
};

/** `POST /complaints/:id/evidence` — one photo, and there is a cap of five. */
export const useAddComplaintPhoto = (locale: Locale) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; photo: { contentType: 'image/jpeg' | 'image/png' | 'image/webp'; contentBase64: string } }) => complaintsApi.addEvidence(input.id, input.photo, { locale }),
    onSuccess: (_result, input) => {
      void queryClient.invalidateQueries({ queryKey: complaintsKeys.detail(input.id) });
    },
    retry: false
  });
};
