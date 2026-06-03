import { desc, eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { classes, announcements, smsTemplates, notificationLog } from "@/db/schema";
import { AnnouncementComposer, TemplateForm } from "@/components/comms/composers";
import { SmsComposer } from "@/components/comms/sms-composer";

export const dynamic = "force-dynamic";

export default async function CommunicationPage() {
  const { school } = await requireSchool();
  const data = await withSchool(school.id, async (tx) => {
    const cls = await tx.select().from(classes).where(eq(classes.schoolId, school.id));
    const recentAnnouncements = await tx
      .select()
      .from(announcements)
      .where(eq(announcements.schoolId, school.id))
      .orderBy(desc(announcements.postedAt))
      .limit(10);
    const templates = await tx
      .select()
      .from(smsTemplates)
      .where(eq(smsTemplates.schoolId, school.id))
      .orderBy(desc(smsTemplates.createdAt));
    const log = await tx
      .select()
      .from(notificationLog)
      .where(eq(notificationLog.schoolId, school.id))
      .orderBy(desc(notificationLog.createdAt))
      .limit(15);
    return { cls, recentAnnouncements, templates, log };
  });

  const classOptions = data.cls.map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="mx-auto max-w-page">
      <h1 className="mb-1 font-display text-3xl font-semibold text-navy">
        Communication
      </h1>
      <p className="mb-6 text-sm text-navy-3">Announcements and SMS to guardians.</p>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Announcements */}
        <section>
          <h2 className="mb-3 font-display text-xl font-semibold text-navy">
            Announcements
          </h2>
          <AnnouncementComposer classOptions={classOptions} />
          <div className="mt-4 space-y-2">
            {data.recentAnnouncements.length === 0 ? (
              <p className="text-sm text-navy-3">No announcements yet.</p>
            ) : (
              data.recentAnnouncements.map((a) => (
                <div
                  key={a.id}
                  className="bg-surface rounded-lg border border-border px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-navy">{a.title}</span>
                    <span className="rounded-pill bg-gold-bg px-2 py-0.5 text-xs text-navy-2">
                      {a.audience === "WHOLE_SCHOOL" ? "Whole school" : "Class"}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-navy-2">{a.body}</p>
                </div>
              ))
            )}
          </div>
        </section>

        {/* SMS */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-xl font-semibold text-navy">
              SMS to guardians
            </h2>
            <TemplateForm />
          </div>
          <SmsComposer classOptions={classOptions} templates={data.templates} />

          {data.templates.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-navy-3">
                Template library
              </h3>
              <div className="space-y-1.5">
                {data.templates.map((t) => (
                  <div
                    key={t.id}
                    className="bg-surface rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    <span className="font-medium text-navy">{t.name}</span>
                    <span className="ml-2 text-navy-3">{t.body}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-navy-3">
              Recent sends
            </h3>
            {data.log.length === 0 ? (
              <p className="text-sm text-navy-3">No messages sent yet.</p>
            ) : (
              <div className="bg-surface overflow-hidden rounded-xl border border-border">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-border">
                    {data.log.map((l) => (
                      <tr key={l.id}>
                        <td className="px-3 py-2 font-mono text-xs text-navy-3">
                          {l.phone}
                        </td>
                        <td className="max-w-0 truncate px-3 py-2 text-navy-2">
                          {l.message}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span
                            className={`rounded-pill px-2 py-0.5 text-xs font-medium ${l.status === "SENT" ? "bg-green-bg text-green" : "bg-terra-bg text-terra"}`}
                          >
                            {l.status.charAt(0) + l.status.slice(1).toLowerCase()}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
