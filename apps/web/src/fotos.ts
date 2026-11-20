/** Achica la foto en el celular antes de mandarla: más rápido con mala señal y ocupa poco en la base. */
export async function prepararFoto(archivo: File, ladoMaximo = 1600, calidad = 0.82): Promise<string> {
  let imagen: ImageBitmap;
  try {
    imagen = await createImageBitmap(archivo);
  } catch {
    throw new Error("No se pudo abrir la foto. Probá sacarla de nuevo o elegir otra.");
  }
  const escala = Math.min(1, ladoMaximo / Math.max(imagen.width, imagen.height));
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.round(imagen.width * escala);
  lienzo.height = Math.round(imagen.height * escala);
  const contexto = lienzo.getContext("2d");
  if (!contexto) throw new Error("Tu navegador no permite procesar la foto.");
  contexto.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
  imagen.close();
  const blob = await new Promise<Blob | null>((resolver) => lienzo.toBlob(resolver, "image/jpeg", calidad));
  if (!blob) throw new Error("No se pudo preparar la foto.");
  const datos = new Uint8Array(await blob.arrayBuffer());
  let binario = "";
  for (let i = 0; i < datos.length; i += 0x8000) binario += String.fromCharCode(...datos.subarray(i, i + 0x8000));
  return btoa(binario);
}
