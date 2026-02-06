import type { Config } from 'drizzle-kit';
import * as dotenv from 'dotenv';

dotenv.config();

export default {
  schema: './src/supabase/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:[YOUR-PASSWORD]@db.gbsopnbovsxlstnmaaga.supabase.co:5432/postgres',
  },
} satisfies Config;
