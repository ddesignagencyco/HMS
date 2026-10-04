"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/* Renders an otpauth URI as a scannable QR code. The SVG is generated
   locally in the browser, so the secret never leaves the device for this.
   It draws at 224px with a white padded frame — comfortably above the 200px
   minimum authenticator apps need — and a skeleton holds the space meanwhile
   so the layout never jumps when it appears. */
export function TotpQrCode({ uri, label }: { uri: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    QRCode.toString(uri, { type: "svg", margin: 2, width: 256 })
      .then((svg) => {
        if (live) setSrc(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
      })
      .catch(() => {
        /* Generation failed: the manual key below remains the way in. */
      });
    return () => {
      live = false;
    };
  }, [uri]);

  if (src === null) {
    return <span className="skeleton mx-auto block size-56 rounded-[9px]" aria-hidden="true" />;
  }

  return (
    <span className="mx-auto block w-fit rounded-[9px] border border-line bg-white p-3">
      <img src={src} alt={label} width={224} height={224} className="block size-56" />
    </span>
  );
}
