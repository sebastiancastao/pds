import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://bwvnvzlmqqcdemkpecjw.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3dm52emxtcXFjZGVta3BlY2p3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1OTI2ODI2MCwiZXhwIjoyMDc0ODQ0MjYwfQ.acBOpif0MypfkFyg2jWe-_xwzkfKEQXd_NmaOImD12E'
)

const { data, error } = await supabase.auth.admin.createUser({
  id: '6653b190-0eaa-457d-abd9-70a4c92ed917',
  email: 'christinatsuan@gmail.com',
  password:'1234567',
  email_confirm: true,
  user_metadata: { full_name: 'Christina Tsuan' }
})

console.log({ data, error })
