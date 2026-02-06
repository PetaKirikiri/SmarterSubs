# Schema Inspection Scripts

## Using Service Role Key (Recommended)

The service role key has elevated permissions and can bypass Row Level Security (RLS), making it ideal for schema inspection.

### Setup

1. Add your service role key to `.env`:
   ```env
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
   ```
   
   Get it from: **Supabase Dashboard → Settings → API → service_role key**

2. Run the inspection script:
   ```bash
   npx tsx scripts/inspect-schema.ts
   ```

### What It Does

- Queries each table via Supabase client (bypasses RLS with service role key)
- Infers column types from actual data
- Attempts to query `information_schema` if possible
- Outputs results to `drizzle-introspect/schema-inspection.json`

### Limitations

- **Cannot directly query `information_schema`** via Supabase REST API (PostgREST limitation)
- Column types are inferred from sample data (may not be 100% accurate)
- Empty tables won't show column information

## Using Drizzle Kit Introspection (Most Accurate)

For the most accurate schema inspection, use Drizzle Kit with a direct PostgreSQL connection:

```bash
npx drizzle-kit introspect --out ./drizzle-introspect
```

**Requires**: `DATABASE_URL` in `.env` with actual database password.

This method:
- ✅ Queries PostgreSQL `information_schema` directly
- ✅ Gets exact column types, nullability, defaults
- ✅ Works even with empty tables
- ✅ Shows foreign keys, indexes, constraints

## Recommendation

1. **First try**: Use the service role key script (`scripts/inspect-schema.ts`) - easier, no password needed
2. **If you need exact types**: Use Drizzle Kit introspection with `DATABASE_URL`
