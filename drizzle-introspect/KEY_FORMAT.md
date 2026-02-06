# Supabase Key Format Guide

## Service Role Key Format

Supabase service role keys are **JWT tokens** that start with `eyJ...`

Example:
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdic29wbmJvdnN4bHN0bm1hYWdhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTY5ODc2ODAwMCwiZXhwIjo0ODU0NTI0MDAwfQ.abc123...
```

## Where to Find It

1. Go to **Supabase Dashboard**
2. Navigate to **Settings → API**
3. Scroll to **Project API keys**
4. Copy the **`service_role`** key (⚠️ Keep this secret!)

## Current Issue

Your `.env` file shows a key starting with `sbp_`:
```
SUPABASE_SERVICE_ROLE_KEY=sbp_360e0c9075609b726bb332a9ea2731ce8e89d6a4
```

This format suggests it might be:
- A different type of key (not the service_role key)
- An incomplete key
- A key from a different service

## Solution

1. **Verify you're copying the correct key**:
   - It should be the **`service_role`** key (not `anon` or `public`)
   - It should start with `eyJ`
   - It's usually very long (200+ characters)

2. **Update `.env`**:
   ```env
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```

3. **Re-run inspection**:
   ```bash
   npx tsx scripts/inspect-schema.ts
   ```

## Alternative: Use Database Password

If you prefer to use the database password instead:

1. Get your database password from: **Settings → Database → Connection string**
2. Extract the password from the connection string
3. Update `.env`:
   ```env
   DATABASE_URL=postgresql://postgres:your-actual-password@db.gbsopnbovsxlstnmaaga.supabase.co:5432/postgres
   ```
4. Run Drizzle Kit introspection:
   ```bash
   npx drizzle-kit introspect --out ./drizzle-introspect
   ```
