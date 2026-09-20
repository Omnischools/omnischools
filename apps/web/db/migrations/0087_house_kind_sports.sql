CREATE TYPE "public"."house_kind" AS ENUM('BOARDING', 'SPORTS');--> statement-breakpoint
ALTER TABLE "house" ADD COLUMN "kind" "house_kind" DEFAULT 'BOARDING' NOT NULL;