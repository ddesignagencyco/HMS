import type { MetadataRoute } from "next";
import { getDictionary } from "@/lib/dictionaries";

/** Installable web app description. Name and copy come from the dictionary. */
export default function manifest(): MetadataRoute.Manifest {
  const dict = getDictionary("en");
  return {
    name: dict.brand.name,
    short_name: dict.brand.name,
    description: dict.brand.tagline,
    start_url: "/en",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0b2a5b",
    orientation: "portrait-primary",
    icons: [
      { src: "/brand/logo.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/logo.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  };
}
