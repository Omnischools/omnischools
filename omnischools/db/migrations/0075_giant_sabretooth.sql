CREATE TABLE "pta_officer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"pta_id" uuid NOT NULL,
	"person_user_id" uuid,
	"external_name" text,
	"office" text NOT NULL,
	"assignment_basis" text NOT NULL,
	"election_ref" text NOT NULL,
	"term_start" date NOT NULL,
	"term_end" date,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pta_officer_at_most_one_holder" CHECK (NOT ("pta_officer"."person_user_id" IS NOT NULL AND "pta_officer"."external_name" IS NOT NULL)),
	CONSTRAINT "pta_officer_assignment_basis_valid" CHECK ("pta_officer"."assignment_basis" IN ('ELECTED', 'APPOINTED'))
);
--> statement-breakpoint
ALTER TABLE "pta_officer" ADD CONSTRAINT "pta_officer_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pta_officer" ADD CONSTRAINT "pta_officer_person_user_id_ref_user_id_fk" FOREIGN KEY ("person_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pta_officer" ADD CONSTRAINT "pta_officer_school_id_pta_id_ptas_school_id_id_fk" FOREIGN KEY ("school_id","pta_id") REFERENCES "public"."ptas"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_pta_officer_current" ON "pta_officer" USING btree ("school_id","pta_id","office") WHERE "pta_officer"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "pta_officer_person_idx" ON "pta_officer" USING btree ("school_id","person_user_id");