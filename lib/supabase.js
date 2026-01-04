import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://gpejabvyiyifpexnvenk.supabase.co';
const supabaseAnonKey = 'sb_publishable_d8DSs_MJSd0siZWHZxJcfw_uOIw5zDB';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
