CREATE TABLE "plc_cpd_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid,
	"attended_pts" numeric(5, 2) NOT NULL,
	"reflection_pts" numeric(5, 2) NOT NULL,
	"settled_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_plc_cpd_ledger" UNIQUE("school_id","session_id","user_id"),
	CONSTRAINT "plc_cpd_ledger_attended_pts_nonneg" CHECK ("plc_cpd_ledger"."attended_pts" >= 0),
	CONSTRAINT "plc_cpd_ledger_reflection_pts_nonneg" CHECK ("plc_cpd_ledger"."reflection_pts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "plc_cpd_ledger" ADD CONSTRAINT "plc_cpd_ledger_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plc_cpd_ledger" ADD CONSTRAINT "plc_cpd_ledger_user_id_ref_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plc_cpd_ledger" ADD CONSTRAINT "plc_cpd_ledger_school_id_session_id_plc_session_school_id_id_fk" FOREIGN KEY ("school_id","session_id") REFERENCES "public"."plc_session"("school_id","id") ON DELETE cascade ON UPDATE no action;