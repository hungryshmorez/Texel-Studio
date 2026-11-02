// imageUtils.ts — read and shrink reference images in the browser.

const MAX_EDGE = 1024;
const KEEP_ORIGINAL_UNDER = 700_000; // data-URL characters

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("That file is not an image the browser can open."));
    image.src = src;
  });
}

/** Keeps small images as they are and shrinks big ones to at most 1024 px on the long edge. */
export async function prepareImage(file: File): Promise<{ dataUrl: string; mime: string }> {
  const original = await readAsDataUrl(file);
  if (original.length <= KEEP_ORIGINAL_UNDER) return { dataUrl: original, mime: file.type };
  const image = await loadImage(original);
  const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot resize images.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL("image/jpeg", 0.85), mime: "image/jpeg" };
}
