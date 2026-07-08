-- AlterTable
ALTER TABLE "users" ADD COLUMN     "daily_due_limit" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "daily_new_limit" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "native_language" TEXT NOT NULL DEFAULT 'ru';
