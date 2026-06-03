"use server";
import { redirect } from "next/navigation";
import { signInWithPhone, verifyPhoneOtp, signOut } from "@/lib/auth";

export async function requestOtp(
  phone: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!phone || phone.length < 7)
    return { ok: false, error: "Enter a valid phone number." };
  return signInWithPhone(phone);
}

export async function verifyLogin(
  phone: string,
  token: string,
): Promise<{ ok: false; error: string }> {
  const res = await verifyPhoneOtp(phone, token);
  if (!res.ok) return { ok: false, error: res.error ?? "Invalid code." };
  redirect("/dashboard");
}

export async function signOutAction(): Promise<void> {
  await signOut();
  redirect("/");
}
