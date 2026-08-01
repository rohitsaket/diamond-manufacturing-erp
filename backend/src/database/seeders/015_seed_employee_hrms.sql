-- Seed HR profile, KYC and statutory flags on the existing employees
SET @admin_id = (SELECT id FROM users WHERE email = 'admin@harene.com' LIMIT 1);

-- Fixed-pay workers need a monthly salary for the payroll engine to prorate
UPDATE employees SET monthly_salary = 22000.00, pf_applicable = true, esi_applicable = true
WHERE emp_code = 'DHAR-401';

UPDATE employees SET monthly_salary = 18000.00, pf_applicable = true, esi_applicable = true
WHERE emp_code = 'MAXI';

-- Piece-rate karigars: PF applies, ESI depends on earnings
UPDATE employees SET pf_applicable = true, esi_applicable = true
WHERE worker_type = 'PIECE_RATE' AND deleted_at IS NULL;

UPDATE employees SET
  department = 'Polishing', designation = 'Senior Karigar', city = 'Surat', gender = 'MALE',
  dob = '1988-04-12', blood_group = 'B+', address = '14 Mahavir Nagar, Katargam, Surat',
  aadhaar_number = '451236789012', pan = 'ABCPA1234F',
  bank_name = 'HDFC Bank', bank_account = '50100234567890', bank_ifsc = 'HDFC0001234',
  emergency_contact_name = 'Nita Arora', emergency_contact_phone = '+91-9876500011'
WHERE emp_code = '301';

UPDATE employees SET
  department = 'Polishing', designation = 'Karigar', city = 'Surat', gender = 'FEMALE',
  dob = '1994-08-05', blood_group = 'O+', address = '7 Sneh Society, Varachha, Surat',
  aadhaar_number = '561237890123', pan = 'BCDPM2345G',
  bank_name = 'ICICI Bank', bank_account = '002401567890', bank_ifsc = 'ICIC0000024',
  emergency_contact_name = 'Rakesh Mehta', emergency_contact_phone = '+91-9876500012'
WHERE emp_code = '302';

UPDATE employees SET
  department = 'Blocking', designation = 'Karigar', city = 'Surat', gender = 'MALE',
  dob = '1985-11-30', blood_group = 'A+', address = '22 Gopal Park, Kapodra, Surat',
  bank_name = 'State Bank of India', bank_account = '30124567890', bank_ifsc = 'SBIN0003012',
  emergency_contact_name = 'Meena Patel', emergency_contact_phone = '+91-9876500013'
WHERE emp_code = '303';

UPDATE employees SET
  department = 'Polishing', designation = 'Dhar Operator', city = 'Surat', gender = 'MALE',
  dob = '1990-02-19', blood_group = 'AB+', address = '5 Shanti Residency, Amroli, Surat',
  aadhaar_number = '671238901234', bank_name = 'Bank of Baroda',
  bank_account = '20045678901', bank_ifsc = 'BARB0SURATX'
WHERE emp_code = 'DHAR-401';

UPDATE employees SET department = 'Polishing', designation = 'Karigar', city = 'Surat', gender = 'MALE', dob = '1996-06-25' WHERE emp_code = '304';
UPDATE employees SET department = 'Assortment', designation = 'Unit', city = 'Surat' WHERE emp_code = 'MAXI';
UPDATE employees SET department = 'Polishing', designation = 'Junior Karigar', city = 'Surat', gender = 'MALE', dob = '2000-08-09' WHERE emp_code = '305';
UPDATE employees SET department = 'Assortment', designation = 'Assorter', city = 'Surat', gender = 'FEMALE', dob = '1992-08-14' WHERE emp_code = '306';
UPDATE employees SET department = 'Polishing', designation = 'Karigar', city = 'Surat', gender = 'MALE', dob = '1983-03-03' WHERE emp_code = '307';
UPDATE employees SET department = 'Blocking', designation = 'Karigar', city = 'Surat', gender = 'FEMALE', dob = '1997-12-01' WHERE emp_code = '308';

-- Reporting lines: the senior karigar supervises the polishing floor
SET @senior_id = (SELECT id FROM employees WHERE emp_code = '301' LIMIT 1);
UPDATE employees SET reporting_manager_id = @senior_id
WHERE emp_code IN ('302', '304', '305', '308', 'DHAR-401') AND deleted_at IS NULL;
