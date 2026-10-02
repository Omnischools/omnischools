"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The six-box TOTP input (Lucy A.1 `.otp-row` / `.otp-box`, reused by G1.b, G1.c and the G7 step-up).
 *
 * Visual contract from the mock: square cells (`aspect-square`), Mono 20px, `filled` =
 * `border-gold bg-gold-bg`, `cursor` (the focused cell) = `border-navy`.
 *
 * The value is mirrored into a single hidden input so the surrounding `<form>` posts ONE `code`
 * field to the server action. Six separate named inputs would make the server reassemble the code
 * from six parts and get the order right, which is a pointless place to be able to make a mistake.
 *
 * Paste is handled: officers copy codes out of their authenticator app, and a paste that only filled
 * the first box would read as the app being broken.
 */
export function OtpInput({
  name = "code",
  length = 6,
  disabled,
  onComplete,
  autoFocus,
}: {
  name?: string;
  length?: number;
  disabled?: boolean;
  onComplete?: (code: string) => void;
  autoFocus?: boolean;
}) {
  const [digits, setDigits] = useState<string[]>(() => Array(length).fill(""));
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const code = digits.join("");

  function commit(next: string[]) {
    setDigits(next);
    const joined = next.join("");
    if (joined.length === length && !next.includes("")) onComplete?.(joined);
  }

  function setAt(index: number, raw: string) {
    const only = raw.replace(/\D/g, "");
    if (only.length === 0) {
      const next = [...digits];
      next[index] = "";
      commit(next);
      return;
    }
    // A multi-character value means a paste (or a fast typist): spread it across the cells.
    const next = [...digits];
    for (let i = 0; i < only.length && index + i < length; i += 1) {
      next[index + i] = only[i]!;
    }
    commit(next);
    const landing = Math.min(index + only.length, length - 1);
    refs.current[landing]?.focus();
  }

  function onKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && digits[index] === "" && index > 0) {
      event.preventDefault();
      const next = [...digits];
      next[index - 1] = "";
      commit(next);
      refs.current[index - 1]?.focus();
    }
    if (event.key === "ArrowLeft" && index > 0) refs.current[index - 1]?.focus();
    if (event.key === "ArrowRight" && index < length - 1)
      refs.current[index + 1]?.focus();
  }

  return (
    <div>
      <div className="mt-2 flex gap-2">
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={(el) => {
              refs.current[index] = el;
            }}
            // `text` + a numeric inputMode rather than `number`: a number input brings spinners and
            // lets a browser accept "1e5" as a value.
            type="text"
            inputMode="numeric"
            autoComplete={index === 0 ? "one-time-code" : "off"}
            aria-label={`Digit ${index + 1} of ${length}`}
            maxLength={length}
            disabled={disabled}
            autoFocus={autoFocus && index === 0}
            value={digit}
            onChange={(e) => setAt(index, e.target.value)}
            onKeyDown={(e) => onKeyDown(index, e)}
            className={cn(
              "aspect-square w-full rounded-md border bg-bg text-center font-mono text-xl text-navy outline-none",
              digit ? "border-gold bg-gold-bg" : "border-border-2",
              "focus:border-navy",
            )}
          />
        ))}
      </div>
      <input type="hidden" name={name} value={code} />
    </div>
  );
}
