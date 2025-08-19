
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

let supabase;

try {
  dotenv.config({ path: path.join(__dirname, '../../.env') });
  dotenv.config();

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  console.log("supabaseUrl: ", supabaseUrl);

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase URL or Key is missing in environment variables.');
  }

  supabase = createClient(supabaseUrl, supabaseKey, {
    db: { schema: 'public' }
  });
  

} catch (error) {
  console.error('Failed to initialize Supabase client:', error);
  supabase = null;
}

module.exports = supabase;