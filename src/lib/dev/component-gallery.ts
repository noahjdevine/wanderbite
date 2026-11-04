/** The Golden Hour specimen page is for local development only. */
export function isComponentGalleryEnabled(
  nodeEnv: string | undefined = process.env.NODE_ENV
): boolean {
  return nodeEnv !== "production";
}
