/**
 * Build a download filename prefixed with the school's name, e.g.
 * `schoolFile("Asankrangwa Senior High School", "students.csv")`
 *   → "Asankrangwa Senior High School-students.csv".
 * Pure + client/server safe. Strips characters illegal in filenames.
 */
export function schoolFilePrefix(name?: string | null): string {
  return (
    (name ?? "")
      .replace(/[\\/:*?"<>|]+/g, "") // illegal filename chars
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60) || "school"
  );
}

export function schoolFile(name: string | null | undefined, suffix: string): string {
  return `${schoolFilePrefix(name)}-${suffix}`;
}
