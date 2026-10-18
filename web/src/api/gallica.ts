// Gallica's `.highres` viewer URLs often 500 when loaded as <img> sources;
// the IIIF Image API is the endpoint Gallica recommends for fetching images.
export function gallicaImageUrl(
  gallicaUrl: string,
  folio: number,
  width = 1500,
): string {
  const base = gallicaUrl.replace(/\/$/, "").replace("/ark:/", "/iiif/ark:/");
  return `${base}/f${folio}/full/${width},/0/native.jpg`;
}
