/**
 * PDF font roles for the document components.
 *
 * We use @react-pdf's built-in standard fonts (always present, zero bundling) as reliable
 * stands-in for the brand faces, preserving the serif / sans / mono distinction the design
 * relies on:
 *   Fraunces (display serif)  → Times-Roman
 *   Manrope  (body sans)      → Helvetica
 *   JetBrains Mono            → Courier
 *
 * FOLLOW-UP (named in the PDF-engine PR): register the real brand TTFs via Font.register once
 * serverless font-file bundling (outputFileTracingIncludes on Vercel) is deploy-tested — it
 * can't be verified in this environment, and a failed font load would break rendering, so we
 * ship on the guaranteed-present core fonts first. Swapping is a one-file change here.
 */
export const SERIF = "Times-Roman";
export const SANS = "Helvetica";
export const MONO = "Courier";
