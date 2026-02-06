# How to Find or Reset Your Supabase Database Password

## Important: Database Password ≠ Google Login Password

Your Google email password is for **logging into the Supabase dashboard**.  
The **database password** is a separate password set when your Supabase project was created.

## Option 1: Find Your Existing Password

1. Go to **Supabase Dashboard** → Your Project
2. Navigate to **Settings → Database**
3. Scroll to **Connection string** section
4. Look for **Connection pooling** or **Direct connection**
5. The connection string will look like:
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.gbsopnbovsxlstnmaaga.supabase.co:5432/postgres
   ```
6. The password is between `postgres:` and `@db.`

## Option 2: Reset Your Database Password

If you don't remember the password:

1. Go to **Supabase Dashboard** → Your Project
2. Navigate to **Settings → Database**
3. Scroll to **Database password** section
4. Click **Reset database password**
5. Copy the new password immediately (you won't see it again!)
6. Update `.env`:
   ```env
   DATABASE_URL=postgresql://postgres:new-password-here@db.gbsopnbovsxlstnmaaga.supabase.co:5432/postgres
   ```

## Option 3: Use Service Role Key Instead

If you prefer not to reset the password:

1. Go to **Supabase Dashboard** → Your Project
2. Navigate to **Settings → API**
3. Look for **"Legacy API Keys"** tab (might be at bottom of page)
4. Copy the **`service_role`** key (starts with `eyJ...`, very long)
5. Update `.env`:
   ```env
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```
6. Run: `npx tsx scripts/inspect-schema.ts`

## Recommendation

**Reset the password** (Option 2) - it's quick and you'll have it for future use. The service role key method works but requires finding the Legacy API Keys tab.
