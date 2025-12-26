import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const name = searchParams.get('name');

    if (!name) {
      return NextResponse.json({ error: 'Missing name parameter' }, { status: 400 });
    }

    // Query profiles for matching official_name
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('user_id')
      .eq('official_name', name)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows found
        return NextResponse.json({ user_id: null, message: 'No matching employee found' }, { status: 200 });
      }
      console.error('Error matching employee:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ user_id: data?.user_id || null }, { status: 200 });
  } catch (err: any) {
    console.error('SERVER ERROR in match-employee:', err);
    return NextResponse.json({ error: err.message || err }, { status: 500 });
  }
}
