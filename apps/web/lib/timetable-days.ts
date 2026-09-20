export const DAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
] as const;

export const DAY_LABEL: Record<number, string> = Object.fromEntries(
  DAYS.map((d) => [d.value, d.label]),
);
