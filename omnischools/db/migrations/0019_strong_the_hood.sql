ALTER TABLE "payment" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "void_is_refund" boolean DEFAULT false NOT NULL;