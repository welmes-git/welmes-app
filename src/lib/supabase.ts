import { createClient } from '@supabase/supabase-js';

const viteEnv = import.meta.env as ImportMetaEnv | undefined;
const supabaseUrl = viteEnv?.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseAnonKey = viteEnv?.VITE_SUPABASE_ANON_KEY || 'public-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
