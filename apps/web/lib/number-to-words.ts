/**
 * Spell a Ghana-cedi amount in words for receipts, e.g. 340 → "three hundred and forty
 * Ghana cedis", 1204.5 → "one thousand, two hundred and four Ghana cedis and fifty
 * pesewas". Lowercase, matching the receipt surface's in-words style.
 */
const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
  "eighteen", "nineteen",
];
const TENS = [
  "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
];
const SCALES: [number, string][] = [
  [1_000_000_000, "billion"],
  [1_000_000, "million"],
  [1_000, "thousand"],
];

/** Spell a whole number below 1000 (no leading "and"). */
function underThousand(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) {
    const t = TENS[Math.floor(n / 10)];
    const r = n % 10;
    return r ? `${t}-${ONES[r]}` : t;
  }
  const h = Math.floor(n / 100);
  const r = n % 100;
  return r ? `${ONES[h]} hundred and ${underThousand(r)}` : `${ONES[h]} hundred`;
}

/** Spell any non-negative integer. */
function spellInteger(n: number): string {
  if (n === 0) return "zero";
  const parts: string[] = [];
  let rest = n;
  for (const [value, name] of SCALES) {
    if (rest >= value) {
      parts.push(`${underThousand(Math.floor(rest / value))} ${name}`);
      rest %= value;
    }
  }
  if (rest > 0) {
    // Join a trailing hundreds/tens group with "and" when there's a higher group.
    parts.push(parts.length > 0 && rest < 100 ? `and ${underThousand(rest)}` : underThousand(rest));
  }
  return parts.join(", ");
}

export function amountInWordsGhs(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.abs(amount) : 0;
  const cedis = Math.floor(safe);
  const pesewas = Math.round((safe - cedis) * 100);
  const cedisWords = `${spellInteger(cedis)} Ghana ${cedis === 1 ? "cedi" : "cedis"}`;
  if (pesewas === 0) return cedisWords;
  return `${cedisWords} and ${spellInteger(pesewas)} ${pesewas === 1 ? "pesewa" : "pesewas"}`;
}
