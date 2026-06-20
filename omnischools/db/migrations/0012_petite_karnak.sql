CREATE TABLE "grade_scale" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"grade" text NOT NULL,
	"label" text,
	"min_score" numeric(5, 2) NOT NULL,
	"ordinal" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_grade_per_school" UNIQUE("school_id","grade")
);
--> statement-breakpoint
ALTER TABLE "grade_scale" ADD CONSTRAINT "grade_scale_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "grade_scale_school_idx" ON "grade_scale" USING btree ("school_id");