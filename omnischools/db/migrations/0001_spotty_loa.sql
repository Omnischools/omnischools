CREATE TABLE "marketing_lead" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"organisation" text,
	"email" text NOT NULL,
	"phone" text,
	"message" text,
	"source" text DEFAULT 'demo_form' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
