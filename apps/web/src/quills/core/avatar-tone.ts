// Soft theme-token tones, so a name keeps its color in the light and dark themes.
const tones = [
  "bg-info/15 text-info-foreground",
  "bg-success/15 text-success-foreground",
  "bg-warning/20 text-warning-foreground",
  "bg-destructive/15 text-destructive-foreground",
  "bg-primary/10 text-foreground",
] as const;

/** The avatar color classes of a name. The same name always gets the same tone. */
export function avatarTone(name: string | null | undefined) {
  let hash = 0;
  for (const char of name ?? "") hash = (hash * 31 + char.codePointAt(0)!) | 0;
  return tones[Math.abs(hash) % tones.length]!;
}
