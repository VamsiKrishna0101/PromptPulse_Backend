DO $$ BEGIN
  CREATE TYPE "AgencyMembershipRole" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST', 'CLIENT_ADMIN', 'CLIENT_VIEWER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AgencyMembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'REMOVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AgencyInvitationType" AS ENUM ('TEAM_MEMBER', 'CLIENT_USER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AgencyInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "AgencyMembership" (
  "id" TEXT NOT NULL,
  "agency_user_id" TEXT NOT NULL,
  "member_user_id" TEXT NOT NULL,
  "role" "AgencyMembershipRole" NOT NULL DEFAULT 'ANALYST',
  "status" "AgencyMembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgencyMembership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AgencyInvitation" (
  "id" TEXT NOT NULL,
  "agency_user_id" TEXT NOT NULL,
  "invitee_user_id" TEXT,
  "email" TEXT NOT NULL,
  "type" "AgencyInvitationType" NOT NULL DEFAULT 'TEAM_MEMBER',
  "role" "AgencyMembershipRole" NOT NULL DEFAULT 'ANALYST',
  "token" TEXT NOT NULL,
  "status" "AgencyInvitationStatus" NOT NULL DEFAULT 'PENDING',
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgencyInvitation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AgencyClientLink" (
  "id" TEXT NOT NULL,
  "agency_user_id" TEXT NOT NULL,
  "client_user_id" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'CLIENT_ADMIN',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgencyClientLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AgencyMembership_agency_user_id_member_user_id_key" ON "AgencyMembership"("agency_user_id", "member_user_id");
CREATE INDEX IF NOT EXISTS "AgencyMembership_member_user_id_status_idx" ON "AgencyMembership"("member_user_id", "status");
CREATE INDEX IF NOT EXISTS "AgencyMembership_agency_user_id_status_idx" ON "AgencyMembership"("agency_user_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "AgencyInvitation_token_key" ON "AgencyInvitation"("token");
CREATE INDEX IF NOT EXISTS "AgencyInvitation_email_status_idx" ON "AgencyInvitation"("email", "status");
CREATE INDEX IF NOT EXISTS "AgencyInvitation_agency_user_id_status_idx" ON "AgencyInvitation"("agency_user_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "AgencyClientLink_agency_user_id_client_user_id_key" ON "AgencyClientLink"("agency_user_id", "client_user_id");
CREATE INDEX IF NOT EXISTS "AgencyClientLink_client_user_id_status_idx" ON "AgencyClientLink"("client_user_id", "status");

DO $$ BEGIN
  ALTER TABLE "AgencyMembership" ADD CONSTRAINT "AgencyMembership_agency_user_id_fkey" FOREIGN KEY ("agency_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AgencyMembership" ADD CONSTRAINT "AgencyMembership_member_user_id_fkey" FOREIGN KEY ("member_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AgencyInvitation" ADD CONSTRAINT "AgencyInvitation_agency_user_id_fkey" FOREIGN KEY ("agency_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AgencyInvitation" ADD CONSTRAINT "AgencyInvitation_invitee_user_id_fkey" FOREIGN KEY ("invitee_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AgencyClientLink" ADD CONSTRAINT "AgencyClientLink_agency_user_id_fkey" FOREIGN KEY ("agency_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AgencyClientLink" ADD CONSTRAINT "AgencyClientLink_client_user_id_fkey" FOREIGN KEY ("client_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

