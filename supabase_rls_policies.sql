-- 1. Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Create a helper function to get user role
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER;


-- 2. Policies for PROFILES
-- Any authenticated user can view their own profile
CREATE POLICY "Users can view own profile" 
ON profiles FOR SELECT 
USING (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile" 
ON profiles FOR UPDATE 
USING (auth.uid() = id);

-- Admins can view all profiles
CREATE POLICY "Admins can view all profiles" 
ON profiles FOR SELECT 
USING (get_user_role() = 'admin');


-- 3. Policies for DEPARTMENTS
-- Everyone can view departments (publicly visible for booking)
CREATE POLICY "Everyone can view departments" 
ON departments FOR SELECT 
TO authenticated 
USING (true);


-- 4. Policies for DOCTORS
-- Everyone can view active doctors
CREATE POLICY "Everyone can view active doctors" 
ON doctors FOR SELECT 
TO authenticated 
USING (is_active = true OR get_user_role() = 'admin');

-- Doctors can update their own details
CREATE POLICY "Doctors can update own details" 
ON doctors FOR UPDATE 
USING (auth.uid() = profile_id);


-- 5. Policies for PATIENTS
-- Patients can view their own record
CREATE POLICY "Patients can view own record" 
ON patients FOR SELECT 
USING (auth.uid() = profile_id);

-- Doctors can view ALL patients (or restrict to their own patients based on appointments if strict)
CREATE POLICY "Doctors can view all patients" 
ON patients FOR SELECT 
USING (get_user_role() = 'doctor');

-- Admins can view all patients
CREATE POLICY "Admins can view all patients" 
ON patients FOR SELECT 
USING (get_user_role() = 'admin');


-- 6. Policies for APPOINTMENTS
-- Patients can view their own appointments
CREATE POLICY "Patients can view own appointments" 
ON appointments FOR SELECT 
USING (
  patient_id IN (SELECT id FROM patients WHERE profile_id = auth.uid())
);

-- Doctors can view appointments assigned to them
CREATE POLICY "Doctors can view assigned appointments" 
ON appointments FOR SELECT 
USING (
  doctor_id IN (SELECT id FROM doctors WHERE profile_id = auth.uid())
);


-- 7. Policies for AUDIT LOGS
-- Anyone can insert an audit log (when an action is taken)
CREATE POLICY "Anyone can insert audit logs" 
ON audit_logs FOR INSERT 
WITH CHECK (auth.uid() = user_id);

-- Only Admins can read audit logs
CREATE POLICY "Only Admins can view audit logs" 
ON audit_logs FOR SELECT 
USING (get_user_role() = 'admin');
