import { revalidatePath } from "next/cache";

/**
 * revalidatePath that no-ops outside a request scope (e.g. when a server action is
 * invoked from a Node verification script). Harmless during real requests.
 */
export function safeRevalidate(path: string): void {
  try {
    revalidatePath(path);
  } catch {
    // not in a request scope — ignore
  }
}
