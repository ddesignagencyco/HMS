import type { ImageAsset, Text } from "@/lib/types";

/* The two decorative photographs, and nothing else.
 *
 * These used to be exported from `lib/data.ts` alongside that module's
 * fabricated dataset — six categories, eighteen services, twelve areas, seven
 * invented professionals with ratings and verified-job counts, and eight
 * testimonials with reviewer names. Two call sites imported only `heroImage`,
 * but `data.ts` is one module with top-level `const`s, so importing either
 * constant pulled the whole invented dataset into the shipped client bundle.
 *
 * Nothing renders that data any more, so it has been split: the pictures stay,
 * because a photograph is not a claim, and the fabricated records are gone
 * rather than left one import away. */

const text = (en: string, ur: string): Text => ({ en, ur });

export const heroImage: ImageAsset = {
  url: "/images/auth-technician.jpg",
  alt: text(
    "Verified professional home technician ready for service in a modern home",
    "جدید گھر میں سروس کے لیے تیار تصدیق شدہ پیشہ ور ٹیکنیشن",
  ),
};

/* Single frame for the process journey: a professional on site, tools in hand. */
export const journeyImage: ImageAsset = {
  url: "/images/auth-technician-ceiling.jpg",
  alt: text(
    "Verified technicians performing precision installation and maintenance on site",
    "سائٹ پر درستگی کے ساتھ تنصیب اور دیکھ بھال کا کام کرتے ہوئے تصدیق شدہ کاریگر",
  ),
};