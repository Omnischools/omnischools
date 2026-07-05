ALTER TABLE "receipt" ADD COLUMN "public_token" text;--> statement-breakpoint
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_public_token_unique" UNIQUE("public_token");