CREATE TABLE "terminal_exam_result" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"exam_type" text NOT NULL,
	"year" integer NOT NULL,
	"female_candidates" integer NOT NULL,
	"male_candidates" integer NOT NULL,
	"female_passed" integer NOT NULL,
	"male_passed" integer NOT NULL,
	"note" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"captured_by" uuid,
	CONSTRAINT "uniq_terminal_exam_result_sitting" UNIQUE("school_id","exam_type","year"),
	CONSTRAINT "terminal_exam_result_exam_type_valid" CHECK ("terminal_exam_result"."exam_type" IN ('BECE', 'WASSCE')),
	CONSTRAINT "terminal_exam_result_female_candidates_nonneg" CHECK ("terminal_exam_result"."female_candidates" >= 0),
	CONSTRAINT "terminal_exam_result_male_candidates_nonneg" CHECK ("terminal_exam_result"."male_candidates" >= 0),
	CONSTRAINT "terminal_exam_result_female_passed_bounds" CHECK ("terminal_exam_result"."female_passed" >= 0 AND "terminal_exam_result"."female_passed" <= "terminal_exam_result"."female_candidates"),
	CONSTRAINT "terminal_exam_result_male_passed_bounds" CHECK ("terminal_exam_result"."male_passed" >= 0 AND "terminal_exam_result"."male_passed" <= "terminal_exam_result"."male_candidates"),
	CONSTRAINT "terminal_exam_result_min_one_candidate" CHECK ("terminal_exam_result"."female_candidates" + "terminal_exam_result"."male_candidates" >= 1)
);
--> statement-breakpoint
ALTER TABLE "terminal_exam_result" ADD CONSTRAINT "terminal_exam_result_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal_exam_result" ADD CONSTRAINT "terminal_exam_result_captured_by_ref_user_id_fk" FOREIGN KEY ("captured_by") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;