CREATE TABLE "vlc_peer_guide" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"academic_period_id" uuid NOT NULL,
	"appointed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"appointed_by_user_id" uuid,
	"ended_at" timestamp with time zone,
	"ended_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vlc_peer_guide_tenant_uk" UNIQUE("school_id","id")
);
--> statement-breakpoint
CREATE TABLE "vlc_training" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"academic_year" text NOT NULL,
	"scheduled_date" date NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"duration_min" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vlc_training_tenant_uk" UNIQUE("school_id","id"),
	CONSTRAINT "vlc_training_duration_min_positive" CHECK ("vlc_training"."duration_min" > 0)
);
--> statement-breakpoint
CREATE TABLE "vlc_training_absence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"training_id" uuid NOT NULL,
	"peer_guide_id" uuid NOT NULL,
	"excused" boolean DEFAULT false NOT NULL,
	"note" text,
	"recorded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_vlc_training_absence" UNIQUE("school_id","training_id","peer_guide_id")
);
--> statement-breakpoint
ALTER TABLE "vlc_peer_guide" ADD CONSTRAINT "vlc_peer_guide_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_peer_guide" ADD CONSTRAINT "vlc_peer_guide_appointed_by_user_id_ref_user_id_fk" FOREIGN KEY ("appointed_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_peer_guide" ADD CONSTRAINT "vlc_peer_guide_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_peer_guide" ADD CONSTRAINT "vlc_peer_guide_school_id_class_id_class_school_id_id_fk" FOREIGN KEY ("school_id","class_id") REFERENCES "public"."class"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_peer_guide" ADD CONSTRAINT "vlc_peer_guide_school_id_academic_period_id_academic_period_school_id_period_id_fk" FOREIGN KEY ("school_id","academic_period_id") REFERENCES "public"."academic_period"("school_id","period_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_training" ADD CONSTRAINT "vlc_training_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_training_absence" ADD CONSTRAINT "vlc_training_absence_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_training_absence" ADD CONSTRAINT "vlc_training_absence_recorded_by_user_id_ref_user_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_training_absence" ADD CONSTRAINT "vlc_training_absence_school_id_training_id_vlc_training_school_id_id_fk" FOREIGN KEY ("school_id","training_id") REFERENCES "public"."vlc_training"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_training_absence" ADD CONSTRAINT "vlc_training_absence_school_id_peer_guide_id_vlc_peer_guide_school_id_id_fk" FOREIGN KEY ("school_id","peer_guide_id") REFERENCES "public"."vlc_peer_guide"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_vlc_peer_guide_active" ON "vlc_peer_guide" USING btree ("school_id","student_id","academic_period_id") WHERE "vlc_peer_guide"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "vlc_peer_guide_class_period_idx" ON "vlc_peer_guide" USING btree ("school_id","class_id","academic_period_id");--> statement-breakpoint
CREATE INDEX "vlc_training_year_idx" ON "vlc_training" USING btree ("school_id","academic_year");--> statement-breakpoint
CREATE INDEX "vlc_training_absence_peer_guide_idx" ON "vlc_training_absence" USING btree ("school_id","peer_guide_id");