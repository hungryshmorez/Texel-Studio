// download.ts — save generated text or bytes as a file from the browser.
export function downloadBlob(filename: string, data: string | Uint8Array, type: string) {
  // Copying a byte array gives the Blob an ordinary ArrayBuffer, which is what the Blob constructor accepts.
  const url = URL.createObjectURL(new Blob([typeof data === "string" ? data : new Uint8Array(data)], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
