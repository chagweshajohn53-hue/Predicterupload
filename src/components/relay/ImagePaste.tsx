import { useState } from "react";
import { ClipboardPaste, ImagePlus, Loader2, X } from "lucide-react";
import { imageDimensions } from "@/lib/vision";
import { Btn } from "./ui";

/** Downscale to a lightweight JPEG data URL for lightning-fast processing and upload. */
export async function toDataUrl(blob: Blob, max = 1200): Promise<string> {
  const isNamedImage = blob instanceof File && !blob.type && /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(blob.name);
  if (!blob.size || (!blob.type.startsWith("image/") && !isNamedImage)) throw new Error("Choose a non-empty picture file.");
  let source: ImageBitmap | HTMLImageElement;
  let objectUrl: string | undefined;
  try {
    if (typeof createImageBitmap === "function") source = await createImageBitmap(blob);
    else throw new Error("Use image element decoding");
  } catch {
    objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.src = objectUrl;
    try { await image.decode(); } catch { URL.revokeObjectURL(objectUrl); throw new Error("This picture cannot be opened. Try a PNG or JPEG."); }
    source = image;
  }
  try {
    const rawW = source instanceof HTMLImageElement ? source.naturalWidth || source.width : source.width;
    const rawH = source instanceof HTMLImageElement ? source.naturalHeight || source.height : source.height;
    const c = document.createElement("canvas");
    const dims = imageDimensions(rawW || 1, rawH || 1, max);
    c.width = dims.width; c.height = dims.height;
    const ctx = c.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Picture processing is unavailable in this browser.");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(source, 0, 0, c.width, c.height);
    const encodeJpeg = (q: number) =>
      new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't prepare this picture."))), "image/jpeg", q));
    let jpeg = await encodeJpeg(0.75);
    if (jpeg.size > 400_000) jpeg = await encodeJpeg(0.60);
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Couldn't read this picture."));
      reader.onerror = () => reject(new Error("Couldn't read this picture."));
      reader.readAsDataURL(jpeg);
    });
  } finally {
    if ("close" in source) source.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

/** Pull images out of a paste event; returns true if any were found. */
export async function imagesFromPaste(e: React.ClipboardEvent, add: (urls: string[]) => void, onError?: (message: string) => void) {
  const files = [...e.clipboardData.items].filter((i) => i.type.startsWith("image/")).map((i) => i.getAsFile()).filter((f): f is File => f !== null).slice(0, 6);
  if (!files.length) return false;
  e.preventDefault();
  try { add(await Promise.all(files.map((f) => toDataUrl(f)))); }
  catch (e) { onError?.(e instanceof Error ? e.message : "Couldn't paste this picture."); }
  return true;
}

export function ImagePaste({ images, setImages, onText, disabled = false }: { images: string[]; setImages: (fn: (p: string[]) => string[]) => void; onText: (t: string) => void; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const add = (u: string[]) => setImages((p) => [...p, ...u].slice(0, 6));
  const paste = async () => {
    setBusy(true); setError("");
    try {
      const items = await navigator.clipboard.read();
      const blobs: Blob[] = [];
      for (const it of items) {
        const img = it.types.find((t) => t.startsWith("image/"));
        if (img && blobs.length < 6 - images.length) blobs.push(await it.getType(img));
        else if (it.types.includes("text/plain")) onText(await (await it.getType("text/plain")).text());
      }
      add(await Promise.all(blobs.map((blob) => toDataUrl(blob))));
    } catch {
      try { onText(await navigator.clipboard.readText()); } catch { setError("Clipboard blocked — paste into the text box or choose Add picture."); }
    } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Btn type="button" variant="ghost" disabled={disabled || busy} onClick={() => void paste()}>{busy ? <Loader2 size={14} className="animate-spin" /> : <ClipboardPaste size={14} />} {busy ? "Preparing…" : "Paste"}</Btn>
        <Btn type="button" variant="ghost" disabled={disabled || busy || images.length >= 6} onClick={(e) => e.currentTarget.parentElement?.querySelector<HTMLInputElement>("input[type=file]")?.click()}><ImagePlus size={14} /> Add picture</Btn>
        <input type="file" aria-label="Add pictures" accept="image/*" multiple hidden disabled={disabled || busy || images.length >= 6} onChange={async (e) => {
          const files = [...(e.target.files ?? [])].slice(0, 6 - images.length); e.target.value = "";
          if (!files.length) return;
          setBusy(true); setError("");
          try { add(await Promise.all(files.map((f) => toDataUrl(f)))); }
          catch (err) { setError(err instanceof Error ? err.message : "Couldn't open this picture."); }
          finally { setBusy(false); }
        }} />
        {images.length > 0 && <span className="font-mono text-[10px] text-muted-foreground">{images.length}/6 pictures · read by a vision model</span>}
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((u, i) => (
            <div key={i} className="relative">
              <img src={u} alt={`pasted ${i + 1}`} className="h-16 w-24 rounded border border-border object-cover" />
              <Btn type="button" variant="danger" disabled={disabled || busy} aria-label="Remove picture" onClick={() => setImages((p) => p.filter((_, j) => j !== i))} className="absolute -right-1 -top-1 p-0.5"><X size={10} /></Btn>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
