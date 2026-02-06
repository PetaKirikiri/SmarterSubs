# Migration from Firebase to Supabase (Drizzle)

## Setup Steps

### 1. Get Supabase Credentials

1. Go to your Supabase project dashboard
2. Go to Settings > API
3. Copy:
   - **Project URL** (e.g., `https://gbsopnbovsxlstnmaaga.supabase.co`)
   - **anon/public key** (starts with `eyJ...`)

### 2. Update Environment Variables

Create a `.env` file in the project root:

```env
VITE_SUPABASE_URL=https://gbsopnbovsxlstnmaaga.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.gbsopnbovsxlstnmaaga.supabase.co:5432/postgres
```

**Important**: Replace `[YOUR-PASSWORD]` with your actual Supabase database password (found in Settings > Database).

### 3. Create Database Tables

Run Drizzle migrations to create the tables:

```bash
# Generate migration files
npx drizzle-kit generate

# Apply migrations (you'll need to run this via Supabase SQL editor or CLI)
# Or use: npx drizzle-kit push
```

Alternatively, you can run the SQL directly in Supabase SQL Editor. The schema is defined in `src/db/schema.ts`.

### 4. Update Code

The code has been updated to use Supabase client. The main changes:
- `src/config/firebaseConfig.ts` → `src/config/supabase.ts`
- `src/services/dbQueries.ts` - New query service
- `src/services/dbWrites.ts` - New write service
- `App.tsx` and `saveWordData.ts` need to be updated to use new services

### 5. Data Migration

You'll need to migrate existing Firebase data to Supabase. This can be done via:
- Export from Firebase
- Transform to match new schema
- Import to Supabase

## Notes

- The Supabase client works client-side (browser)
- Drizzle schema is defined but we're using Supabase client for queries (can switch to Drizzle via API routes later)
- All queries maintain similar structure to Firebase for easier migration
