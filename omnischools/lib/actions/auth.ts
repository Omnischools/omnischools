"use server";
import { redirect } from "next/navigation";
import { signInWithPhone, verifyPhoneOtp, signInWithPassword, signOut } from "@/lib/auth";

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

export async function passwordLogin(
  phone: string,
  password: string,
): Promise<{ ok: false; error: string }> {
  if (!phone || !password) return { ok: false, error: "Enter your phone and password." };
  const res = await signInWithPassword(phone, password);
  if (!res.ok) return { ok: false, error: res.error ?? "Invalid phone or password." };
  redirect("/dashboard");
}

export async function signOutAction(): Promise<void> {
  await signOut();
  redirect("/");
}
