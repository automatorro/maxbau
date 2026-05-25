-- Migration: 20260525181000_has_role_permissions_fix.sql
-- Restores public execution privileges to public.has_role() to prevent PG RLS query permission crashes for anonymous clients.

-- Restore public execute permission for policies to evaluate correctly
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO public;
