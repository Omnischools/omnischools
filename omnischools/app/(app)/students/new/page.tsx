import Link from "next/link";
import { NewStudentForm } from "@/components/students/new-student-form";

export const metadata = { title: "Add student" };

export default function NewStudentPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/students" className="text-sm text-navy-3 hover:text-gold">
        ← Students
      </Link>
      <h1 className="mb-6 mt-2 font-display text-3xl font-semibold text-navy">
        Add a student
      </h1>
      <NewStudentForm />
    </div>
  );
}
