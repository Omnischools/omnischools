"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateStaff, saveStaffProfile } from "@/lib/actions/staff";
import { QUALIFICATION_LEVELS } from "@/lib/staff-qualifications";
import { Modal } from "@/components/ui/modal";

const fieldClass =
  "w-full rounded-md border border-border-2 bg-bg px-3.5 py-2.5 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";
const labelClass = "mb-1 block text-xs font-semibold text-navy-2";

export type StaffProfileInitial = {
  fullName: string;
  phone: string;
  email: string;
  dateOfBirth: string;
  gender: string;
  address: string;
  emergencyContact: string;
  qualificationLevel: string;
  highestQualification: string;
  undergraduate: string;
  ntcLicenceNumber: string;
  ntcLicenceExpiry: string;
  specialisations: string;
};

export function StaffProfileEdit({
  userId,
  initial,
}: {
  userId: string;
  initial: StaffProfileInitial;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<StaffProfileInitial>(initial);

  function set<K extends keyof StaffProfileInitial>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function close() {
    setOpen(false);
    setError(null);
    setForm(initial);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const identity = await updateStaff({
        userId,
        fullName: form.fullName,
        phone: form.phone,
        email: form.email,
      });
      if (!identity.ok) {
        setError(identity.error ?? "Could not save the staff record.");
        return;
      }
      const profile = await saveStaffProfile({
        userId,
        dateOfBirth: form.dateOfBirth,
        gender: form.gender,
        address: form.address,
        emergencyContact: form.emergencyContact,
        qualificationLevel: form.qualificationLevel,
        highestQualification: form.highestQualification,
        undergraduate: form.undergraduate,
        ntcLicenceNumber: form.ntcLicenceNumber,
        ntcLicenceExpiry: form.ntcLicenceExpiry,
        specialisations: form.specialisations,
      });
      if (!profile.ok) {
        setError(profile.error ?? "Could not save the staff profile.");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-navy px-3.5 py-2 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep"
      >
        Edit profile
      </button>

      <Modal open={open} onClose={close} title="Edit staff profile">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="max-h-[70vh] space-y-5 overflow-y-auto pr-0.5"
        >
          {/* Identity */}
          <fieldset className="space-y-3">
            <legend className="text-[11px] font-bold uppercase tracking-[0.1em] text-navy-3">
              Identity
            </legend>
            <div>
              <label className={labelClass}>Full name</label>
              <input
                value={form.fullName}
                onChange={(e) => set("fullName", e.target.value)}
                required
                className={fieldClass}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Phone (login)</label>
                <input
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  type="tel"
                  required
                  className={fieldClass}
                />
              </div>
              <div>
                <label className={labelClass}>
                  Email <span className="font-medium text-navy-3">— optional</span>
                </label>
                <input
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  type="email"
                  className={fieldClass}
                />
              </div>
            </div>
          </fieldset>

          {/* Personal & contact */}
          <fieldset className="space-y-3">
            <legend className="text-[11px] font-bold uppercase tracking-[0.1em] text-navy-3">
              Personal &amp; contact
            </legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Date of birth</label>
                <input
                  value={form.dateOfBirth}
                  onChange={(e) => set("dateOfBirth", e.target.value)}
                  type="date"
                  className={fieldClass}
                />
              </div>
              <div>
                <label className={labelClass}>Gender</label>
                <select
                  value={form.gender}
                  onChange={(e) => set("gender", e.target.value)}
                  className={fieldClass}
                >
                  <option value="">—</option>
                  <option value="Female">Female</option>
                  <option value="Male">Male</option>
                </select>
              </div>
            </div>
            <div>
              <label className={labelClass}>Address</label>
              <input
                value={form.address}
                onChange={(e) => set("address", e.target.value)}
                className={fieldClass}
              />
            </div>
            <div>
              <label className={labelClass}>Emergency contact</label>
              <input
                value={form.emergencyContact}
                onChange={(e) => set("emergencyContact", e.target.value)}
                placeholder="Name · relationship · phone"
                className={fieldClass}
              />
            </div>
          </fieldset>

          {/* Qualifications & licensure */}
          <fieldset className="space-y-3">
            <legend className="text-[11px] font-bold uppercase tracking-[0.1em] text-navy-3">
              Qualifications &amp; licensure
            </legend>
            <div>
              <label className={labelClass}>Qualification level</label>
              <select
                value={form.qualificationLevel}
                onChange={(e) => set("qualificationLevel", e.target.value)}
                className={fieldClass}
              >
                <option value="">—</option>
                {QUALIFICATION_LEVELS.map((q) => (
                  <option key={q.code} value={q.code}>
                    {q.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Highest qualification</label>
              <input
                value={form.highestQualification}
                onChange={(e) => set("highestQualification", e.target.value)}
                placeholder="e.g. MEd Mathematics · UCC · 2019"
                className={fieldClass}
              />
            </div>
            <div>
              <label className={labelClass}>Undergraduate</label>
              <input
                value={form.undergraduate}
                onChange={(e) => set("undergraduate", e.target.value)}
                className={fieldClass}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass}>NTC licence no.</label>
                <input
                  value={form.ntcLicenceNumber}
                  onChange={(e) => set("ntcLicenceNumber", e.target.value)}
                  className={fieldClass}
                />
              </div>
              <div>
                <label className={labelClass}>NTC licence expiry</label>
                <input
                  value={form.ntcLicenceExpiry}
                  onChange={(e) => set("ntcLicenceExpiry", e.target.value)}
                  type="date"
                  className={fieldClass}
                />
              </div>
            </div>
            <div>
              <label className={labelClass}>Specialisations</label>
              <input
                value={form.specialisations}
                onChange={(e) => set("specialisations", e.target.value)}
                placeholder="Comma-separated, e.g. Mathematics, Science"
                className={fieldClass}
              />
            </div>
          </fieldset>

          {error && <p className="text-sm text-terra">{error}</p>}

          <div className="flex items-center gap-3 border-t border-border pt-4">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              onClick={close}
              className="text-sm font-semibold text-navy-2 hover:text-navy"
            >
              Cancel
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
