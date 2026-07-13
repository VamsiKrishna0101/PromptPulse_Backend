ALTER TABLE "User"
ADD COLUMN "product_tour_completed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "product_tour_completed_at" TIMESTAMP(3);
