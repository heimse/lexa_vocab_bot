-- AlterTable
ALTER TABLE "users" ADD COLUMN     "notify_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notify_hour" INTEGER NOT NULL DEFAULT 10;
