CREATE TABLE "fact_infrastructure" (
	"fact_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"schools_reporting" integer DEFAULT 1 NOT NULL,
	"classrooms_total" integer NOT NULL,
	"classrooms_good" integer NOT NULL,
	"classrooms_repair" integer NOT NULL,
	"latrines_boys" integer NOT NULL,
	"latrines_girls" integer NOT NULL,
	"latrines_staff" integer NOT NULL,
	"student_desks_usable" integer,
	"student_desks_broken" integer,
	"teacher_desks" integer,
	"chalkboards" integer,
	"whiteboards" integer,
	"projectors" integer,
	"computers_total" integer,
	"computers_working" integer,
	"library_book_count" integer,
	"has_electricity_count" integer NOT NULL,
	"has_water_count" integer NOT NULL,
	"has_handwashing_count" integer NOT NULL,
	"has_library_count" integer NOT NULL,
	"has_ict_lab_count" integer NOT NULL,
	"has_internet_count" integer NOT NULL,
	"gsfp_participating_count" integer NOT NULL,
	"has_kitchen_count" integer NOT NULL,
	"water_borehole_count" integer NOT NULL,
	"water_pipe_count" integer NOT NULL,
	"water_well_count" integer NOT NULL,
	"water_none_count" integer NOT NULL,
	"electricity_grid_count" integer NOT NULL,
	"electricity_solar_count" integer NOT NULL,
	"electricity_generator_count" integer NOT NULL,
	"electricity_none_count" integer NOT NULL,
	"latrine_wc_count" integer NOT NULL,
	"latrine_kvip_count" integer NOT NULL,
	"latrine_pit_count" integer NOT NULL,
	"latrine_none_count" integer NOT NULL,
	"computers_reporting_count" integer NOT NULL,
	"library_books_reporting_count" integer NOT NULL,
	"furniture_reporting_count" integer NOT NULL,
	"source" "ov_source" NOT NULL,
	"as_of_date" timestamp with time zone NOT NULL,
	"etl_run_id" uuid
);
--> statement-breakpoint
CREATE TABLE "fact_plc_participation" (
	"fact_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"schools_running_plc_count" integer NOT NULL,
	"teacher_headcount" integer,
	"sessions_held" integer,
	"sessions_expected" integer,
	"attendance_events" integer,
	"attendance_expected" integer,
	"plc_participation_rate" numeric(5, 2),
	"teachers_in_plc" integer,
	"cpd_points_total" numeric(7, 2),
	"cpd_points_teacher_count" integer,
	"cpd_points_mean" numeric(5, 2),
	"teachers_meeting_cpd_threshold" integer,
	"annual_cpd_target" numeric(5, 2),
	"source" "ov_source" NOT NULL,
	"as_of_date" timestamp with time zone NOT NULL,
	"etl_run_id" uuid
);
--> statement-breakpoint
CREATE TABLE "fact_teacher_attendance" (
	"fact_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"expected_teacher_days" integer NOT NULL,
	"present_teacher_days" integer NOT NULL,
	"teacher_attendance_rate" numeric(5, 2) NOT NULL,
	"source" "ov_source" NOT NULL,
	"as_of_date" timestamp with time zone NOT NULL,
	"etl_run_id" uuid
);
--> statement-breakpoint
ALTER TABLE "fact_infrastructure" ADD CONSTRAINT "fact_infrastructure_jurisdiction_id_dim_jurisdiction_jurisdiction_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."dim_jurisdiction"("jurisdiction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_infrastructure" ADD CONSTRAINT "fact_infrastructure_period_id_dim_period_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."dim_period"("period_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_infrastructure" ADD CONSTRAINT "fact_infrastructure_etl_run_id_etl_run_run_id_fk" FOREIGN KEY ("etl_run_id") REFERENCES "public"."etl_run"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_plc_participation" ADD CONSTRAINT "fact_plc_participation_jurisdiction_id_dim_jurisdiction_jurisdiction_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."dim_jurisdiction"("jurisdiction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_plc_participation" ADD CONSTRAINT "fact_plc_participation_period_id_dim_period_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."dim_period"("period_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_plc_participation" ADD CONSTRAINT "fact_plc_participation_etl_run_id_etl_run_run_id_fk" FOREIGN KEY ("etl_run_id") REFERENCES "public"."etl_run"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_teacher_attendance" ADD CONSTRAINT "fact_teacher_attendance_jurisdiction_id_dim_jurisdiction_jurisdiction_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."dim_jurisdiction"("jurisdiction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_teacher_attendance" ADD CONSTRAINT "fact_teacher_attendance_period_id_dim_period_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."dim_period"("period_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_teacher_attendance" ADD CONSTRAINT "fact_teacher_attendance_etl_run_id_etl_run_run_id_fk" FOREIGN KEY ("etl_run_id") REFERENCES "public"."etl_run"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fact_infrastructure_jurisdiction_period_idx" ON "fact_infrastructure" USING btree ("jurisdiction_id","period_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fact_plc_participation_jurisdiction_period_idx" ON "fact_plc_participation" USING btree ("jurisdiction_id","period_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fact_teacher_attendance_jurisdiction_period_idx" ON "fact_teacher_attendance" USING btree ("jurisdiction_id","period_id");--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- HAND-APPENDED (drizzle-kit cannot express RLS in the Drizzle schema, so this block is added by
-- hand after every regeneration of this file — see db/schema/fact.ts).
--
-- RLS is enabled HERE, at CREATE TIME, not later by policies.sql / the prod-paste. Without it these
-- three tables would sit with RLS DISABLED between `db:migrate` and the manual prod-paste, and any
-- SELECT-granted non-owner role (Supabase anon/authenticated in `public`) would read EVERY
-- jurisdiction's rows in that window. With it, the skip-the-paste state is RLS-enabled-with-no-policy
-- => ZERO rows to a non-owner role: genuinely fail-CLOSED, which is what
-- db/sql/prod-paste-0001-fact-domains.sql and docs/PROVISIONING.md §2a promise.
--
-- Deliberately NOT `FORCE ROW LEVEL SECURITY`: the table owner / BYPASSRLS ETL loader must keep
-- writing freely (OVERSIGHT_ANALYTICS_SPEC §8). ENABLE alone leaves the owner exempt.
-- Idempotent: ENABLE on an already-enabled table is a no-op, so policies.sql and the prod-paste
-- (which both re-issue it) stay safe to re-run.
-- ---------------------------------------------------------------------------
ALTER TABLE "fact_teacher_attendance" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fact_infrastructure" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fact_plc_participation" ENABLE ROW LEVEL SECURITY;
