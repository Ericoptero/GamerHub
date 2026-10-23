export function summarizePlatforms(names: string[], max = 5): string {
  if (!names.length) return "plataformas desconhecidas";
  return names.length > max ? `${names.slice(0, max).join(", ")} +${names.length - max}` : names.join(", ");
}
