# How to Get Supabase Keys for Schema Inspection

## The Issue

You copied an **"access token"** (starts with `sbp_`), but that's for Supabase CLI/Management API, not database queries.

## What You Need

For schema inspection, you need **one of these**:

### Option 1: Database Password (Easiest) ✅

1. Go to **Supabase Dashboard → Settings → Database**
2. Find the **Connection string** section
3. Copy the connection string (or extract just the password)
4. Update `.env`:
   ```env
   DATABASE_URL=postgresql://postgres:your-actual-password@db.gbsopnbovsxlstnmaaga.supabase.co:5432/postgres
   ```
5. Run:
   ```bash
   npx drizzle-kit introspect --out ./drizzle-introspect
   ```

### Option 2: Service Role Key (JWT Format)

1. Go to **Supabase Dashboard → Settings → API**
2. Look for **"Legacy API Keys"** tab (might be at the bottom)
3. Find the **`service_role`** key
4. It should:
   - Start with `eyJ...` (JWT format)
   - Be very long (200+ characters)
   - Look like: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdic29wbmJvdnN4bHN0bm1hYWdhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTY5ODc2ODAwMCwiZXhwIjo0ODU0NTI0MDAwfQ.abc123...`
5. Update `.env`:
   ```env
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```
6. Run:
   ```bash
   npx tsx scripts/inspect-schema.ts
   ```

## Key Differences

| Type | Format | Use Case | Where to Find |
|------|--------|----------|---------------|
| **Access Token** | `sbp_...` | CLI, Management API | Settings → API → Access Tokens |
| **Service Role Key** | `eyJ...` | Database queries (bypasses RLS) | Settings → API → Legacy API Keys |
| **Anon Key** | `eyJ...` | Client-side queries (respects RLS) | Settings → API → Legacy API Keys |

## Recommendation

**Use the database password** (Option 1) - it's the most reliable method for schema introspection and doesn't require finding the legacy service_role key.
