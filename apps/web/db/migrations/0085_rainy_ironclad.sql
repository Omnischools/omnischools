CREATE TABLE "vlc_value_change_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"op" text NOT NULL,
	"payload" jsonb NOT NULL,
	"state" text DEFAULT 'PROPOSED' NOT NULL,
	"proposed_by_user_id" uuid,
	"proposed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vlc_value_change_request_op_valid" CHECK ("vlc_value_change_request"."op" IN ('ADD', 'REORDER', 'REMOVE')),
	CONSTRAINT "vlc_value_change_request_state_valid" CHECK ("vlc_value_change_request"."state" IN ('PROPOSED', 'APPROVED', 'REJECTED'))
);
--> statement-breakpoint
ALTER TABLE "vlc_value" ADD COLUMN "descriptor" text;--> statement-breakpoint
ALTER TABLE "vlc_value" ADD COLUMN "is_capstone" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Backfill (issue #296): attach the frozen descriptor + capstone flag to every existing vlc_value BY
-- ORDINAL, from lib/vlc/defaults.ts VLC_VALUES — so no live row loses its descriptor when the reader
-- switches off the ordinal-keyed VLC_VALUE_BY_ORDINAL attach (defaults.ts:296) onto these stored columns.
-- Ordinal is the exact key the current reader uses, so this reproduces today's rendering exactly; applied
-- across all schools; idempotent. is_capstone already defaulted false, so only ordinal 11 (Wisdom) flips true.
UPDATE "vlc_value" v SET
  "descriptor" = d.descriptor,
  "is_capstone" = d.is_capstone
FROM (VALUES
  (1, 'foundation value', false),
  (2, 'honesty & consistency', false),
  (3, 'ownership of self & tasks', false),
  (4, 'self-direction', false),
  (5, 'endurance under difficulty', false),
  (6, 'seeing the other''s burden', false),
  (7, 'love of country, civic duty', false),
  (8, 'peaceful difference', false),
  (9, 'using what you have for others', false),
  (10, 'doing what is good, well', false),
  (11, 'capstone · integration', true)
) AS d(ordinal, descriptor, is_capstone)
WHERE v."ordinal" = d.ordinal;--> statement-breakpoint
ALTER TABLE "vlc_value_change_request" ADD CONSTRAINT "vlc_value_change_request_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_value_change_request" ADD CONSTRAINT "vlc_value_change_request_proposed_by_user_id_ref_user_id_fk" FOREIGN KEY ("proposed_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_value_change_request" ADD CONSTRAINT "vlc_value_change_request_decided_by_user_id_ref_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vlc_value_change_request_state_idx" ON "vlc_value_change_request" USING btree ("school_id","state");