// apps/web/src/features/providers/names.ts
/**
 * Honest label for a professional in the marketplace UI.
 *
 * The search and booking APIs deliberately publish no provider name, so the
 * UI must never invent one. This used to hash the provider id into a made-up
 * "Tariq Malik"-style name; a customer reading that would believe a specific
 * person was coming. What the API does publish is the provider's
 * `qualification`, so that is the label, with a generic fallback ("Professional")
 * when there is none. The initial is a neutral monogram of that label.
 *
 * `providerId` is accepted (and ignored) so existing callers keep their shape.
 */
export function resolveProviderName(
  _providerId: string | null | undefined,
  qualificationOrFallback: string | null | undefined = 'Professional'
): {
  fullName: string;
  firstName: string;
  lastName: string;
  initial: string;
} {
  const label = qualificationOrFallback?.trim() || 'Professional';
  return {
    fullName: label,
    firstName: label,
    lastName: '',
    initial: label.charAt(0).toUpperCase()
  };
}
