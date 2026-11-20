import type { ChainEntry } from "./vault";

/** Only route pictures to known image-capable models; retain saved priority. */
export function supportsImages(entry: ChainEntry): boolean {
  const model = entry.model.toLowerCase();
  if (entry.provider === "gemini") return /^gemini-/.test(model);
  return /llama-4-(scout|maverick)|gemma-3-\d+b|mistral-small-3\.[12]|pixtral|qwen[^/]*\/.*(?:vl|vision)|llama-3\.2-.*vision/.test(model);
}

export function imageDimensions(width: number, height: number, max = 1600) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}