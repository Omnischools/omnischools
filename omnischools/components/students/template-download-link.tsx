"use client";
import { csvTemplate } from "@/lib/import/csv";
import { STUDENT_IMPORT_HEADERS, STUDENT_IMPORT_SAMPLE } from "@/lib/import/student-import";

/** "DOWNLOAD TEMPLATE ↓" — generates the real student-import CSV client-side. */
export function TemplateDownloadLink({ className }: { className?: string }) {
  function download() {
    const csv = csvTemplate(STUDENT_IMPORT_HEADERS, STUDENT_IMPORT_SAMPLE);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "omnischools-students-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <button
      type="button"
      onClick={download}
      className={
        className ??
        "text-xs font-bold uppercase tracking-[0.1em] text-gold transition-colors hover:text-navy"
      }
    >
      Download template ↓
    </button>
  );
}
