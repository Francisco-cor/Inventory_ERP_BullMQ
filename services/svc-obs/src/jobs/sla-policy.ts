export function segundosPendiente(creadaEn: Date | string, ahora = new Date()): number {
  const created = new Date(creadaEn).getTime();
  if (!Number.isFinite(created)) throw new RangeError("creadaEn no es una fecha válida");
  return Math.max(0, Math.floor((ahora.getTime() - created) / 1000));
}

export function debeGenerarSlaWarning(
  creadaEn: Date | string,
  umbralSegundos: number,
  ahora = new Date()
): boolean {
  if (!Number.isInteger(umbralSegundos) || umbralSegundos < 1) {
    throw new RangeError("umbralSegundos debe ser un entero positivo");
  }
  return segundosPendiente(creadaEn, ahora) >= umbralSegundos;
}
