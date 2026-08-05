-- Enterprise attendance configuration, plus a backfill so the July 2026
-- attendance that already exists carries the new enterprise columns and has a
-- matching punch stream behind it.
SET @admin_id = (SELECT id FROM users WHERE email = 'admin@harene.com' LIMIT 1);
SET @hr_id = (SELECT id FROM users WHERE email = 'hr@harene.com' LIMIT 1);
SET @company_id = (SELECT id FROM companies WHERE code = 'HARENE' LIMIT 1);
SET @branch_id = (SELECT id FROM branches WHERE code = 'SURAT' LIMIT 1);
SET @loc_polish = (SELECT id FROM locations WHERE code = 'SURAT-POL2' LIMIT 1);
SET @loc_office = (SELECT id FROM locations WHERE code = 'SURAT-OFF' LIMIT 1);
SET @dept_polish = (SELECT id FROM departments WHERE code = 'DEPT-POLISH' LIMIT 1);

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
INSERT INTO attendance_policies
  (code, name, description, company_id, is_default, priority,
   working_hours_per_day, full_day_hours, half_day_hours, min_hours_for_present, max_hours_per_day, max_hours_per_week,
   grace_minutes, late_after_minutes, late_penalty_type, late_penalty_after_count, max_late_per_month,
   early_exit_grace_minutes, early_exit_penalty_type,
   week_off_days, ot_enabled, ot_requires_approval, ot_min_minutes, ot_rounding_minutes,
   ot_max_hours_per_day, ot_max_hours_per_month,
   ot_multiplier_weekday, ot_multiplier_weekoff, ot_multiplier_holiday, ot_multiplier_night,
   auto_absent_if_no_punch, auto_punch_out_enabled, auto_punch_out_after_hours,
   allowed_capture_methods, require_geofence, allow_remote_punch, allow_offline_punch,
   min_rest_hours_between_shifts, max_consecutive_work_days, mandatory_break_after_hours,
   regularization_window_days, max_regularizations_per_month, effective_from, status, created_by)
VALUES
  ('POL-FACTORY', 'Factory Floor Standard', 'Default policy for Surat factory floor staff on the general shift.',
   @company_id, true, 100,
   9.00, 8.00, 4.00, 4.00, 12.00, 54.00,
   15, 15, 'WARN', 3, 3,
   15, 'WARN',
   '0', true, true, 30, 15,
   4.00, 50.00,
   1.00, 2.00, 2.00, 1.50,
   true, true, 14.00,
   'WEB,MOBILE,KIOSK,BIOMETRIC,QR,NFC,MANUAL,IMPORT', false, false, true,
   11.00, 6, 5.00,
   7, 3, '2026-01-01', 'ACTIVE', @admin_id),

  ('POL-NIGHT', 'Night Shift', 'Cross-midnight crews. Shorter qualifying day and a night overtime multiplier.',
   @company_id, false, 50,
   8.00, 7.50, 3.75, 3.75, 11.00, 48.00,
   20, 20, 'WARN', 4, 4,
   20, 'NONE',
   '0', true, true, 30, 15,
   3.00, 40.00,
   1.00, 2.00, 2.00, 1.50,
   true, true, 13.00,
   'BIOMETRIC,KIOSK,NFC,MANUAL,IMPORT', false, false, true,
   12.00, 5, 4.00,
   7, 3, '2026-01-01', 'ACTIVE', @admin_id),

  ('POL-OFFICE', 'Office and Administration', 'Salaried office staff. Remote punching allowed, no overtime by default.',
   @company_id, false, 60,
   8.00, 8.00, 4.00, 4.00, 10.00, 48.00,
   30, 30, 'NONE', 5, 5,
   30, 'NONE',
   '0,6', false, true, 60, 30,
   2.00, 20.00,
   1.00, 1.50, 2.00, 1.50,
   false, false, NULL,
   'WEB,MOBILE,QR,MANUAL', false, true, true,
   11.00, 6, NULL,
   14, 5, '2026-01-01', 'ACTIVE', @admin_id);

SET @pol_factory = (SELECT id FROM attendance_policies WHERE code = 'POL-FACTORY' LIMIT 1);
SET @pol_night = (SELECT id FROM attendance_policies WHERE code = 'POL-NIGHT' LIMIT 1);
SET @pol_office = (SELECT id FROM attendance_policies WHERE code = 'POL-OFFICE' LIMIT 1);

INSERT INTO attendance_policy_assignments (policy_id, scope_type, scope_id, effective_from, created_by) VALUES
  (@pol_factory, 'GLOBAL', NULL, '2026-01-01', @admin_id),
  (@pol_factory, 'DEPARTMENT', @dept_polish, '2026-01-01', @admin_id);

INSERT INTO attendance_policy_assignments (policy_id, scope_type, scope_value, effective_from, created_by) VALUES
  (@pol_office, 'WORKER_TYPE', 'MONTHLY', '2026-01-01', @admin_id);

-- ---------------------------------------------------------------------------
-- Break catalogue
-- ---------------------------------------------------------------------------
INSERT INTO break_types (code, name, company_id, is_paid, default_minutes, max_minutes, max_per_day, requires_approval, is_mandatory, earliest_start, latest_end, created_by) VALUES
  ('LUNCH', 'Lunch Break', @company_id, false, 60, 75, 1, false, true, '12:00:00', '15:00:00', @admin_id),
  ('TEA_AM', 'Morning Tea', @company_id, true, 15, 20, 1, false, false, '10:30:00', '11:30:00', @admin_id),
  ('TEA_PM', 'Evening Tea', @company_id, true, 15, 20, 1, false, false, '16:00:00', '17:00:00', @admin_id),
  ('PRAYER', 'Prayer Break', @company_id, true, 15, 25, 2, false, false, NULL, NULL, @admin_id),
  ('EXTENDED', 'Extended Break', @company_id, false, 30, 120, 1, true, false, NULL, NULL, @admin_id);

SET @bt_lunch = (SELECT id FROM break_types WHERE code = 'LUNCH' LIMIT 1);

-- ---------------------------------------------------------------------------
-- Shift enrichment. The three existing shifts keep their ids, names and times.
-- ---------------------------------------------------------------------------
UPDATE shifts SET code = 'GEN', company_id = @company_id, branch_id = @branch_id, shift_type = 'FIXED',
  full_day_hours = 8.00, half_day_hours = 4.00, week_off_days = '0', timezone = 'Asia/Kolkata',
  color = '#2563eb', ot_eligible = true
  WHERE name = 'General Shift';
UPDATE shifts SET code = 'EARLY', company_id = @company_id, branch_id = @branch_id, shift_type = 'FIXED',
  full_day_hours = 7.50, half_day_hours = 3.75, week_off_days = '0', timezone = 'Asia/Kolkata',
  color = '#0891b2', ot_eligible = true
  WHERE name = 'Early Shift';
UPDATE shifts SET code = 'EVE', company_id = @company_id, branch_id = @branch_id, shift_type = 'FIXED',
  full_day_hours = 7.50, half_day_hours = 3.75, week_off_days = '0', timezone = 'Asia/Kolkata',
  color = '#7c3aed', ot_eligible = true
  WHERE name = 'Evening Shift';

INSERT INTO shifts (code, name, company_id, branch_id, shift_type, start_time, end_time, crosses_midnight, is_night_shift,
  break_minutes, grace_minutes, week_off_day, week_off_days, full_day_hours, half_day_hours,
  ot_eligible, timezone, color, is_default, status, created_by) VALUES
  ('NIGHT', 'Night Shift', @company_id, @branch_id, 'NIGHT', '22:00:00', '06:00:00', true, true,
   45, 20, 0, '0', 7.50, 3.75, true, 'Asia/Kolkata', '#1e293b', false, 'ACTIVE', @admin_id),
  ('SPLIT', 'Split Shift', @company_id, @branch_id, 'SPLIT', '07:00:00', '11:00:00', false, false,
   0, 15, 0, '0', 8.00, 4.00, true, 'Asia/Kolkata', '#ea580c', false, 'ACTIVE', @admin_id),
  ('FLEXI', 'Flexible Hours', @company_id, @branch_id, 'FLEXIBLE', '08:00:00', '20:00:00', false, false,
   60, 60, 0, '0,6', 8.00, 4.00, false, 'Asia/Kolkata', '#16a34a', false, 'ACTIVE', @admin_id);

UPDATE shifts SET second_start_time = '16:00:00', second_end_time = '20:00:00' WHERE code = 'SPLIT';
UPDATE shifts SET flexible_core_start = '11:00:00', flexible_core_end = '16:00:00', flexible_min_hours = 8.00 WHERE code = 'FLEXI';

SET @shift_gen = (SELECT id FROM shifts WHERE code = 'GEN' LIMIT 1);
SET @shift_early = (SELECT id FROM shifts WHERE code = 'EARLY' LIMIT 1);
SET @shift_night = (SELECT id FROM shifts WHERE code = 'NIGHT' LIMIT 1);

INSERT INTO shift_rotation_patterns (code, name, company_id, description, cycle_days, pattern, created_by) VALUES
  ('ROT-2X2', 'Two Day Two Night', @company_id, 'Two general days, two nights, then a rest day.', 5, '["GEN","GEN","NIGHT","NIGHT","OFF"]', @admin_id),
  ('ROT-WEEKLY', 'Weekly Alternating', @company_id, 'Alternates general and early week by week.', 14, '["GEN","GEN","GEN","GEN","GEN","GEN","OFF","EARLY","EARLY","EARLY","EARLY","EARLY","EARLY","OFF"]', @admin_id);

-- Effective-dated assignments mirroring employees.shift_id, so "which shift on
-- date X" is answerable for the period the seeded attendance covers.
INSERT INTO employee_shift_assignments (employee_id, shift_id, effective_from, is_primary, assignment_reason, created_by)
SELECT e.id, e.shift_id, '2026-01-01', true, 'Initial assignment carried over from the employee record', @admin_id
FROM employees e WHERE e.shift_id IS NOT NULL AND e.deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Geofences and IP rules
-- ---------------------------------------------------------------------------
INSERT INTO geofences (code, name, company_id, branch_id, location_id, fence_type, center_lat, center_lng, radius_m,
  address, allow_methods, enforce_on_in, enforce_on_out, max_accuracy_m, created_by) VALUES
  ('GF-SURAT-MAIN', 'Surat Factory Perimeter', @company_id, @branch_id, NULL, 'CIRCLE', 21.1702000, 72.8311000, 250,
   'Mahidharpura, Surat, Gujarat', 'WEB,MOBILE,KIOSK,QR,NFC', true, false, 100, @admin_id),
  ('GF-SURAT-POL', 'Polishing Floor 2', @company_id, @branch_id, @loc_polish, 'CIRCLE', 21.1703500, 72.8312500, 60,
   'Polishing Floor 2, Surat Factory', 'KIOSK,BIOMETRIC,QR,NFC', true, true, 50, @admin_id),
  ('GF-SURAT-OFF', 'Administration Office', @company_id, @branch_id, @loc_office, 'CIRCLE', 21.1700800, 72.8309000, 80,
   'Administration Office, Surat Factory', 'WEB,MOBILE,QR', true, false, 100, @admin_id);

SET @gf_main = (SELECT id FROM geofences WHERE code = 'GF-SURAT-MAIN' LIMIT 1);
SET @gf_pol = (SELECT id FROM geofences WHERE code = 'GF-SURAT-POL' LIMIT 1);
SET @gf_off = (SELECT id FROM geofences WHERE code = 'GF-SURAT-OFF' LIMIT 1);

INSERT INTO attendance_ip_rules (code, name, rule_type, cidr, company_id, branch_id, created_by) VALUES
  ('IP-FACTORY-LAN', 'Surat factory LAN', 'ALLOW', '192.168.10.0/24', @company_id, @branch_id, @admin_id),
  ('IP-OFFICE-WIFI', 'Surat office wifi', 'ALLOW', '192.168.20.0/24', @company_id, @branch_id, @admin_id);

-- ---------------------------------------------------------------------------
-- Devices
-- ---------------------------------------------------------------------------
INSERT INTO attendance_devices (code, name, device_type, vendor, model, serial_no, firmware_version, ip_address,
  company_id, branch_id, location_id, geofence_id, timezone, supports_in_out, default_punch_type,
  sync_mode, sync_interval_minutes, health_status, status, installed_on, notes, created_by) VALUES
  ('DEV-GATE-01', 'Main Gate Fingerprint', 'BIOMETRIC', 'ZKTeco', 'K40', 'ZK-K40-778201', '6.60', '192.168.10.21',
   @company_id, @branch_id, NULL, @gf_main, 'Asia/Kolkata', true, 'AUTO', 'PUSH', 15, 'UNKNOWN', 'ACTIVE', '2025-04-12',
   'Gate turnstile. Pushes batches to the sync API every fifteen minutes.', @admin_id),
  ('DEV-POL-02', 'Polishing Floor Kiosk', 'QR_KIOSK', 'In-house', 'Tablet Kiosk', 'KIOSK-POL-002', '1.4.0', '192.168.10.42',
   @company_id, @branch_id, @loc_polish, @gf_pol, 'Asia/Kolkata', true, 'AUTO', 'PUSH', 5, 'UNKNOWN', 'ACTIVE', '2025-09-01',
   'Wall tablet showing a rotating QR code.', @admin_id),
  ('DEV-OFF-03', 'Office NFC Reader', 'NFC_READER', 'HID Global', 'Signo 20', 'HID-S20-4471', '2.1.3', '192.168.20.15',
   @company_id, @branch_id, @loc_office, @gf_off, 'Asia/Kolkata', true, 'AUTO', 'PUSH', 15, 'UNKNOWN', 'ACTIVE', '2025-06-20',
   'Card reader at the office door.', @admin_id),
  ('DEV-GATE-04', 'Main Gate Face Terminal', 'FACE', 'ZKTeco', 'SpeedFace V5L', 'ZK-V5L-99120', '3.0.1', '192.168.10.22',
   @company_id, @branch_id, NULL, @gf_main, 'Asia/Kolkata', true, 'AUTO', 'PUSH', 15, 'UNKNOWN', 'MAINTENANCE', '2026-02-10',
   'Face terminal. No matching provider is configured, so it is registered but not trusted for verification.', @admin_id),
  ('DEV-MOBILE', 'Mobile Application', 'MOBILE', 'In-house', 'ESS App', NULL, '1.0.0', NULL,
   @company_id, @branch_id, NULL, @gf_main, 'Asia/Kolkata', true, 'AUTO', 'PUSH', 5, 'UNKNOWN', 'ACTIVE', '2026-01-05',
   'Logical device representing self-service punches from the mobile app.', @admin_id);

SET @dev_gate = (SELECT id FROM attendance_devices WHERE code = 'DEV-GATE-01' LIMIT 1);
SET @dev_kiosk = (SELECT id FROM attendance_devices WHERE code = 'DEV-POL-02' LIMIT 1);
SET @dev_nfc = (SELECT id FROM attendance_devices WHERE code = 'DEV-OFF-03' LIMIT 1);

INSERT INTO device_enrollments (device_id, employee_id, device_user_id, enrollment_type, templates_count, quality_score, enrolled_at, status, created_by)
SELECT @dev_gate, e.id, CONCAT('Z', LPAD(e.id, 4, '0')), 'FINGERPRINT', 2, 82.5, '2026-01-05 09:00:00', 'ACTIVE', @admin_id
FROM employees e WHERE e.work_status = 'WORKING' AND e.deleted_at IS NULL;

UPDATE attendance_devices d SET d.enrolled_count = (SELECT COUNT(*) FROM device_enrollments de WHERE de.device_id = d.id AND de.deleted_at IS NULL);

-- ---------------------------------------------------------------------------
-- NFC cards
-- ---------------------------------------------------------------------------
INSERT INTO nfc_cards (card_uid, card_type, employee_id, card_number, issued_on, expires_on, status, created_by)
SELECT CONCAT('04A', LPAD(HEX(e.id * 7717), 8, '0')), 'MIFARE', e.id, CONCAT('HD-', LPAD(e.id, 5, '0')),
       '2026-01-05', '2028-01-04', 'ACTIVE', @admin_id
FROM employees e WHERE e.work_status = 'WORKING' AND e.deleted_at IS NULL;

UPDATE nfc_cards SET status = 'LOST', reported_lost_at = '2026-07-18 11:20:00', notes = 'Reported lost on the floor. Replacement pending.'
WHERE employee_id = (SELECT id FROM employees WHERE emp_code = '306' LIMIT 1);

-- Face enrolment is recorded as unconfigured rather than active: no matching
-- provider is wired up, so claiming an active enrolment would be a lie.
INSERT INTO face_enrollments (employee_id, provider, images_count, status, status_note, created_by)
SELECT e.id, 'NONE', 0, 'NOT_CONFIGURED', 'No face matching provider is configured for this deployment.', @admin_id
FROM employees e WHERE e.work_status = 'WORKING' AND e.deleted_at IS NULL LIMIT 5;

-- ---------------------------------------------------------------------------
-- Approval workflows
-- ---------------------------------------------------------------------------
INSERT INTO attendance_approval_workflows (request_type, company_id, level, approver_type, approver_role, sla_hours, auto_escalate, escalate_to_type, created_by) VALUES
  ('REGULARIZATION', @company_id, 1, 'REPORTING_MANAGER', NULL, 24, true, 'HR', @admin_id),
  ('REGULARIZATION', @company_id, 2, 'HR', 'hr', 48, false, NULL, @admin_id),
  ('MISSED_PUNCH', @company_id, 1, 'REPORTING_MANAGER', NULL, 24, true, 'HR', @admin_id),
  ('CORRECTION', @company_id, 1, 'REPORTING_MANAGER', NULL, 24, true, 'HR', @admin_id),
  ('CORRECTION', @company_id, 2, 'HR', 'hr', 48, false, NULL, @admin_id),
  ('OVERTIME', @company_id, 1, 'REPORTING_MANAGER', NULL, 24, true, 'HR', @admin_id),
  ('OVERTIME', @company_id, 2, 'ADMIN', 'admin', 72, false, NULL, @admin_id),
  ('SHIFT_CHANGE', @company_id, 1, 'REPORTING_MANAGER', NULL, 48, false, NULL, @admin_id),
  ('SHIFT_SWAP', @company_id, 1, 'REPORTING_MANAGER', NULL, 48, false, NULL, @admin_id),
  ('REMOTE_WORK', @company_id, 1, 'REPORTING_MANAGER', NULL, 24, false, NULL, @admin_id),
  ('ON_DUTY', @company_id, 1, 'REPORTING_MANAGER', NULL, 24, false, NULL, @admin_id),
  ('COMP_OFF', @company_id, 1, 'REPORTING_MANAGER', NULL, 48, true, 'HR', @admin_id),
  ('BREAK_EXTENSION', @company_id, 1, 'REPORTING_MANAGER', NULL, 8, false, NULL, @admin_id),
  ('EARLY_EXIT', @company_id, 1, 'REPORTING_MANAGER', NULL, 24, false, NULL, @admin_id),
  ('LATE_ARRIVAL', @company_id, 1, 'REPORTING_MANAGER', NULL, 24, false, NULL, @admin_id);

-- ---------------------------------------------------------------------------
-- Compliance rules. Thresholds cite the Indian statute they come from so a
-- flagged violation can be defended rather than just asserted.
-- ---------------------------------------------------------------------------
INSERT INTO attendance_compliance_rules (code, name, rule_type, threshold_value, comparison, period, severity, country, company_id, legal_reference, remediation, created_by) VALUES
  ('CMP-DAILY-9', 'Daily hours above nine', 'MAX_DAILY_HOURS', 9.00, 'GT', 'DAY', 'MEDIUM', 'India', @company_id,
   'Factories Act 1948, Section 54 - no adult worker shall work more than nine hours in any day',
   'Review the shift plan for the employee or record approved overtime against the day.', @admin_id),
  ('CMP-WEEKLY-48', 'Weekly hours above forty-eight', 'MAX_WEEKLY_HOURS', 48.00, 'GT', 'WEEK', 'HIGH', 'India', @company_id,
   'Factories Act 1948, Section 51 - weekly hours',
   'Redistribute hours across the roster or grant compensatory time off.', @admin_id),
  ('CMP-REST-11', 'Rest below eleven hours between shifts', 'MIN_REST_HOURS', 11.00, 'LT', 'DAY', 'HIGH', 'India', @company_id,
   'Occupational Safety, Health and Working Conditions Code 2020 - daily rest period',
   'Adjust the roster so the gap between consecutive shifts reaches eleven hours.', @admin_id),
  ('CMP-OT-QTR-50', 'Overtime above fifty hours in a month', 'MAX_OT_MONTHLY', 50.00, 'GT', 'MONTH', 'CRITICAL', 'India', @company_id,
   'Factories Act 1948, Section 64 - overtime limits (state rules vary, Gujarat caps a quarter at 75 hours)',
   'Stop further overtime for the month and review staffing on the affected line.', @admin_id),
  ('CMP-WEEKLY-OFF', 'No weekly off in seven days', 'MANDATORY_WEEKLY_OFF', 1.00, 'LT', 'ROLLING_7', 'HIGH', 'India', @company_id,
   'Factories Act 1948, Section 52 - weekly holidays',
   'Schedule a compensatory off within three days as the section requires.', @admin_id),
  ('CMP-CONSEC-6', 'More than six consecutive working days', 'MAX_CONSECUTIVE_DAYS', 6.00, 'GT', 'ROLLING_30', 'MEDIUM', 'India', @company_id,
   'Factories Act 1948, Section 52 read with Section 53',
   'Insert a rest day into the roster.', @admin_id),
  ('CMP-DAILY-SPREAD', 'Spread-over beyond ten and a half hours', 'MAX_DAILY_HOURS', 10.50, 'GT', 'DAY', 'MEDIUM', 'India', @company_id,
   'Factories Act 1948, Section 56 - spread-over',
   'Shorten the working window or split the assignment across two workers.', @admin_id);

-- ---------------------------------------------------------------------------
-- Visitors and contractors
-- ---------------------------------------------------------------------------
INSERT INTO visitors (visitor_code, visitor_type, full_name, company_name, phone, email, id_proof_type, id_proof_no,
  contractor_agency, contract_from, contract_to, daily_rate, company_id, created_by) VALUES
  ('VIS-0001', 'CONTRACTOR', 'Mahesh Solanki', 'Solanki Facility Services', '+91 98250 11223', NULL, 'AADHAAR', 'XXXX-XXXX-4412',
   'Solanki Facility Services', '2026-04-01', '2027-03-31', 780.00, @company_id, @admin_id),
  ('VIS-0002', 'CONTRACTOR', 'Rekha Chauhan', 'Solanki Facility Services', '+91 98250 11224', NULL, 'AADHAAR', 'XXXX-XXXX-9087',
   'Solanki Facility Services', '2026-04-01', '2027-03-31', 780.00, @company_id, @admin_id),
  ('VIS-0003', 'VENDOR', 'Nitin Desai', 'Gujarat Diamond Tools', '+91 99099 44112', 'nitin@gdtools.example', 'PAN', 'ABCPD1234K',
   NULL, NULL, NULL, NULL, @company_id, @admin_id),
  ('VIS-0004', 'AUDITOR', 'S. Ramanathan', 'Ramanathan and Associates', '+91 90000 33221', NULL, 'PAN', 'AAAPR7788M',
   NULL, NULL, NULL, NULL, @company_id, @admin_id),
  ('VIS-0005', 'TEMP_STAFF', 'Bhavna Rathod', NULL, '+91 97250 55411', NULL, 'AADHAAR', 'XXXX-XXXX-2231',
   'Direct', '2026-07-01', '2026-09-30', 650.00, @company_id, @admin_id);

INSERT INTO visitor_visits (visitor_id, visit_date, host_employee_id, purpose, branch_id, location_id, badge_no,
  expected_in, checked_in_at, checked_out_at, hours, status, safety_briefing_done, created_by)
SELECT v.id, '2026-07-29', (SELECT id FROM employees WHERE emp_code = '301' LIMIT 1),
  'Housekeeping shift', @branch_id, @loc_polish, CONCAT('B-', RIGHT(v.visitor_code, 3)),
  '2026-07-29 08:00:00', '2026-07-29 07:58:00', '2026-07-29 16:04:00', 8.10, 'CHECKED_OUT', true, @admin_id
FROM visitors v WHERE v.visitor_type = 'CONTRACTOR';

INSERT INTO visitor_visits (visitor_id, visit_date, host_employee_id, purpose, branch_id, location_id, badge_no,
  expected_in, checked_in_at, checked_out_at, hours, status, safety_briefing_done, created_by) VALUES
  ((SELECT id FROM visitors WHERE visitor_code = 'VIS-0003' LIMIT 1), '2026-07-30',
   (SELECT id FROM employees WHERE emp_code = '303' LIMIT 1), 'Tool delivery and calibration', @branch_id, @loc_office, 'B-101',
   '2026-07-30 11:00:00', '2026-07-30 11:12:00', '2026-07-30 12:40:00', 1.47, 'CHECKED_OUT', false, @admin_id),
  ((SELECT id FROM visitors WHERE visitor_code = 'VIS-0004' LIMIT 1), '2026-07-31',
   (SELECT id FROM employees WHERE emp_code = '301' LIMIT 1), 'Statutory compliance audit', @branch_id, @loc_office, 'B-102',
   '2026-07-31 10:00:00', '2026-07-31 10:05:00', NULL, NULL, 'CHECKED_IN', true, @admin_id),
  ((SELECT id FROM visitors WHERE visitor_code = 'VIS-0005' LIMIT 1), '2026-07-31',
   (SELECT id FROM employees WHERE emp_code = '305' LIMIT 1), 'Temporary assortment support', @branch_id, @loc_polish, 'B-103',
   '2026-07-31 09:00:00', '2026-07-31 09:02:00', NULL, NULL, 'CHECKED_IN', true, @admin_id);

-- ---------------------------------------------------------------------------
-- Punch-time variation. Seeder 016 gives every single row the same 09:05/19:10
-- pair, which means no employee is ever late and no one ever leaves early --
-- the late, early-exit and exception reports would all be permanently empty on
-- a dataset that looks full. The offsets below are derived from the row id, so
-- they are stable across re-seeds, and status and ot_hours are left alone
-- because payroll reads those. worked_hours is recomputed to stay consistent
-- with the new in/out pair.
--
-- Roughly seven rows in ten stay inside the fifteen-minute grace.
UPDATE attendance_records a
SET a.in_time = SEC_TO_TIME(TIME_TO_SEC('09:00:00') + 60 * (
      CASE WHEN (a.id * 37) MOD 10 < 7 THEN (a.id * 13) MOD 12 ELSE 16 + (a.id * 17) MOD 40 END))
WHERE a.status IN ('PRESENT', 'HALF_DAY');

-- Full days end at 19:00 plus any overtime, with a few early exits.
UPDATE attendance_records a
SET a.out_time = SEC_TO_TIME(TIME_TO_SEC('19:00:00')
      + 60 * (CASE WHEN (a.id * 23) MOD 20 = 0 THEN -(20 + (a.id * 11) MOD 40) ELSE (a.id * 7) MOD 25 END)
      + 3600 * a.ot_hours)
WHERE a.status = 'PRESENT';

-- Half days finish just after lunch.
UPDATE attendance_records a
SET a.out_time = SEC_TO_TIME(TIME_TO_SEC('13:30:00') + 60 * ((a.id * 19) MOD 30))
WHERE a.status = 'HALF_DAY';

-- An absent day has no punches. Carrying in/out times on an ABSENT row is what
-- made the missing-punch queue impossible to populate.
UPDATE attendance_records a
SET a.in_time = NULL, a.out_time = NULL, a.worked_hours = 0, a.is_missing_punch = true
WHERE a.status = 'ABSENT';

UPDATE attendance_records a
SET a.worked_hours = GREATEST(0, ROUND((TIME_TO_SEC(a.out_time) - TIME_TO_SEC(a.in_time) - 3600) / 3600, 2))
WHERE a.status = 'PRESENT' AND a.in_time IS NOT NULL AND a.out_time IS NOT NULL;

UPDATE attendance_records a
SET a.worked_hours = GREATEST(0, ROUND((TIME_TO_SEC(a.out_time) - TIME_TO_SEC(a.in_time)) / 3600, 2))
WHERE a.status = 'HALF_DAY' AND a.in_time IS NOT NULL AND a.out_time IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Backfill the enterprise columns on the attendance already seeded for July.
-- Existing columns (status, ot_hours) are left exactly as they are -- only the
-- new columns are populated.
-- ---------------------------------------------------------------------------
UPDATE attendance_records a
JOIN employees e ON e.id = a.employee_id
SET a.company_id = e.company_id,
    a.branch_id = e.branch_id,
    a.department_id = e.department_id,
    a.timezone = 'Asia/Kolkata',
    a.policy_id = @pol_factory,
    a.first_in_time = a.in_time,
    a.last_out_time = a.out_time,
    a.work_mode = 'OFFICE',
    a.expected_hours = 9.00,
    a.recomputed_at = NOW();

UPDATE attendance_records a
SET a.punch_count = 4,
    a.break_minutes = 60,
    a.unpaid_break_minutes = 60,
    a.paid_break_minutes = 0,
    a.gross_hours = ROUND(TIMESTAMPDIFF(MINUTE, a.in_time, a.out_time) / 60, 2),
    a.device_id = @dev_gate
WHERE a.in_time IS NOT NULL AND a.out_time IS NOT NULL AND a.out_time > a.in_time;

-- Lateness and early exit against the general shift (09:00-19:00, 15 minute grace).
UPDATE attendance_records a
SET a.late_minutes = GREATEST(0, (TIME_TO_SEC(a.in_time) - TIME_TO_SEC('09:00:00')) DIV 60 - 15),
    a.is_late = ((TIME_TO_SEC(a.in_time) - TIME_TO_SEC('09:00:00')) DIV 60 - 15) > 0
WHERE a.in_time IS NOT NULL AND a.status IN ('PRESENT', 'HALF_DAY');

UPDATE attendance_records a
SET a.early_exit_minutes = GREATEST(0, (TIME_TO_SEC('19:00:00') - TIME_TO_SEC(a.out_time)) DIV 60 - 15),
    a.is_early_exit = ((TIME_TO_SEC('19:00:00') - TIME_TO_SEC(a.out_time)) DIV 60 - 15) > 0
WHERE a.out_time IS NOT NULL AND a.status IN ('PRESENT', 'HALF_DAY');

UPDATE attendance_records a
SET a.deficit_hours = GREATEST(0, ROUND(a.expected_hours - COALESCE(a.worked_hours, 0), 2))
WHERE a.status IN ('PRESENT', 'HALF_DAY');

UPDATE attendance_records a
SET a.exception_flags = TRIM(BOTH ',' FROM CONCAT(
      IF(a.is_late, 'LATE,', ''),
      IF(a.is_early_exit, 'EARLY_EXIT,', ''),
      IF(a.ot_hours > 0, 'OVERTIME,', ''),
      IF(a.status = 'ABSENT', 'ABSENT,', '')))
WHERE a.deleted_at IS NULL;

UPDATE attendance_records SET exception_flags = NULL WHERE exception_flags = '';

UPDATE attendance_records a
SET a.ot_type = CASE DAYOFWEEK(a.att_date) WHEN 1 THEN 'WEEK_OFF' ELSE 'WEEKDAY' END,
    a.ot_status = 'APPROVED',
    a.ot_approved_hours = a.ot_hours
WHERE a.ot_hours > 0;

-- ---------------------------------------------------------------------------
-- Overtime ledger derived from the same records, at the policy multipliers.
-- ---------------------------------------------------------------------------
INSERT INTO overtime_records (employee_id, att_date, attendance_id, ot_type, derived_hours, requested_hours,
  approved_hours, multiplier, payable_hours, status, approved_by, approved_at, company_id, branch_id, department_id, created_by)
SELECT a.employee_id, a.att_date, a.id,
  CASE DAYOFWEEK(a.att_date) WHEN 1 THEN 'WEEK_OFF' ELSE 'WEEKDAY' END,
  a.ot_hours, a.ot_hours, a.ot_hours,
  CASE DAYOFWEEK(a.att_date) WHEN 1 THEN 2.00 ELSE 1.00 END,
  ROUND(a.ot_hours * CASE DAYOFWEEK(a.att_date) WHEN 1 THEN 2.00 ELSE 1.00 END, 2),
  'APPROVED', @admin_id, a.updated_at, a.company_id, a.branch_id, a.department_id, @admin_id
FROM attendance_records a
WHERE a.ot_hours > 0 AND a.deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Punch stream behind the daily records. Four punches a day: in, break out,
-- break in, out. device_punch_ref is unique per device so a replayed sync is a
-- no-op rather than a duplicate.
-- ---------------------------------------------------------------------------
INSERT INTO attendance_punches (employee_id, punch_at, punch_date, punch_time, timezone, utc_offset_minutes,
  punch_type, capture_method, work_mode, device_id, device_punch_ref, shift_id,
  geofence_id, geo_status, status, created_by)
SELECT a.employee_id, TIMESTAMP(a.att_date, a.in_time), a.att_date, a.in_time, 'Asia/Kolkata', 330,
  'IN', 'BIOMETRIC', 'OFFICE', @dev_gate, CONCAT('SEED-', a.id, '-IN'), a.shift_id,
  @gf_main, 'INSIDE', 'ACCEPTED', @admin_id
FROM attendance_records a
WHERE a.in_time IS NOT NULL AND a.out_time IS NOT NULL AND a.out_time > a.in_time AND a.deleted_at IS NULL;

INSERT INTO attendance_punches (employee_id, punch_at, punch_date, punch_time, timezone, utc_offset_minutes,
  punch_type, capture_method, work_mode, device_id, device_punch_ref, shift_id,
  geofence_id, geo_status, status, created_by)
SELECT a.employee_id, TIMESTAMP(a.att_date, '13:00:00'), a.att_date, '13:00:00', 'Asia/Kolkata', 330,
  'BREAK_OUT', 'BIOMETRIC', 'OFFICE', @dev_kiosk, CONCAT('SEED-', a.id, '-BO'), a.shift_id,
  @gf_pol, 'INSIDE', 'ACCEPTED', @admin_id
FROM attendance_records a
WHERE a.in_time IS NOT NULL AND a.out_time IS NOT NULL AND a.out_time > '14:00:00' AND a.deleted_at IS NULL;

INSERT INTO attendance_punches (employee_id, punch_at, punch_date, punch_time, timezone, utc_offset_minutes,
  punch_type, capture_method, work_mode, device_id, device_punch_ref, shift_id,
  geofence_id, geo_status, status, created_by)
SELECT a.employee_id, TIMESTAMP(a.att_date, '14:00:00'), a.att_date, '14:00:00', 'Asia/Kolkata', 330,
  'BREAK_IN', 'BIOMETRIC', 'OFFICE', @dev_kiosk, CONCAT('SEED-', a.id, '-BI'), a.shift_id,
  @gf_pol, 'INSIDE', 'ACCEPTED', @admin_id
FROM attendance_records a
WHERE a.in_time IS NOT NULL AND a.out_time IS NOT NULL AND a.out_time > '14:00:00' AND a.deleted_at IS NULL;

INSERT INTO attendance_punches (employee_id, punch_at, punch_date, punch_time, timezone, utc_offset_minutes,
  punch_type, capture_method, work_mode, device_id, device_punch_ref, shift_id,
  geofence_id, geo_status, status, created_by)
SELECT a.employee_id, TIMESTAMP(a.att_date, a.out_time), a.att_date, a.out_time, 'Asia/Kolkata', 330,
  'OUT', 'BIOMETRIC', 'OFFICE', @dev_gate, CONCAT('SEED-', a.id, '-OUT'), a.shift_id,
  @gf_main, 'INSIDE', 'ACCEPTED', @admin_id
FROM attendance_records a
WHERE a.in_time IS NOT NULL AND a.out_time IS NOT NULL AND a.out_time > a.in_time AND a.deleted_at IS NULL;

-- Lunch breaks matching the BREAK_OUT/BREAK_IN pairs above.
INSERT INTO attendance_breaks (attendance_id, employee_id, att_date, break_type_id, start_time, end_time, minutes,
  is_paid, source, created_by)
SELECT a.id, a.employee_id, a.att_date, @bt_lunch, '13:00:00', '14:00:00', 60, false, 'PUNCH', @admin_id
FROM attendance_records a
WHERE a.in_time IS NOT NULL AND a.out_time IS NOT NULL AND a.out_time > '14:00:00' AND a.deleted_at IS NULL;

UPDATE attendance_devices d
SET d.total_punches = (SELECT COUNT(*) FROM attendance_punches p WHERE p.device_id = d.id),
    d.last_punch_at = (SELECT MAX(p.punch_at) FROM attendance_punches p WHERE p.device_id = d.id),
    d.last_sync_at = (SELECT MAX(p.punch_at) FROM attendance_punches p WHERE p.device_id = d.id);

INSERT INTO device_sync_logs (device_id, sync_type, started_at, finished_at, duration_ms, status,
  records_received, records_accepted, records_duplicate, records_rejected, triggered_by)
SELECT d.id, 'PUSH', '2026-07-31 19:15:00', '2026-07-31 19:15:04', 4120, 'SUCCESS',
  d.total_punches, d.total_punches, 0, 0, @admin_id
FROM attendance_devices d WHERE d.total_punches > 0;

INSERT INTO device_sync_logs (device_id, sync_type, started_at, finished_at, duration_ms, status,
  records_received, records_accepted, records_duplicate, records_rejected, error_message, triggered_by) VALUES
  ((SELECT id FROM attendance_devices WHERE code = 'DEV-GATE-04' LIMIT 1), 'PUSH', '2026-07-30 18:00:00', '2026-07-30 18:00:31', 31000,
   'FAILED', 0, 0, 0, 0, 'Connection refused. Terminal is in maintenance and no face provider is configured.', @admin_id);

-- ---------------------------------------------------------------------------
-- A populated request queue so the approval screens have real work in them.
-- ---------------------------------------------------------------------------
INSERT INTO attendance_requests (request_no, request_type, employee_id, att_date, attendance_id, current_value, requested_value,
  requested_hours, reason, status, current_level, total_levels, submitted_at, due_at, company_id, branch_id, department_id, raised_by)
VALUES
  ('AR-2026-0001', 'MISSED_PUNCH',
   (SELECT id FROM employees WHERE emp_code = '302' LIMIT 1), '2026-07-28', NULL,
   '{"outTime": null}', '{"outTime": "19:05"}', NULL,
   'Gate reader did not register my exit punch. Security register has my exit at 7:05 pm.',
   'PENDING', 1, 1, '2026-07-29 09:14:00', '2026-07-30 09:14:00', @company_id, @branch_id, @dept_polish, @admin_id),
  ('AR-2026-0002', 'REGULARIZATION',
   (SELECT id FROM employees WHERE emp_code = '305' LIMIT 1), '2026-07-24', NULL,
   '{"status": "ABSENT"}', '{"status": "PRESENT", "inTime": "09:10", "outTime": "19:00"}', NULL,
   'Was on the floor all day. The fingerprint reader failed to read my thumb that morning.',
   'PENDING', 1, 2, '2026-07-25 10:02:00', '2026-07-26 10:02:00', @company_id, @branch_id, @dept_polish, @admin_id),
  ('AR-2026-0003', 'OVERTIME',
   (SELECT id FROM employees WHERE emp_code = '301' LIMIT 1), '2026-08-01', NULL,
   NULL, '{"hours": 3}', 3.00,
   'Rush order for the Antwerp shipment needs three extra hours on Saturday.',
   'PENDING', 1, 2, '2026-07-31 16:40:00', '2026-08-01 16:40:00', @company_id, @branch_id, @dept_polish, @admin_id),
  ('AR-2026-0004', 'REMOTE_WORK',
   (SELECT id FROM employees WHERE emp_code = '306' LIMIT 1), '2026-08-03', NULL,
   '{"workMode": "OFFICE"}', '{"workMode": "REMOTE"}', NULL,
   'Working from home while recovering from a fever. Assortment paperwork can be done remotely.',
   'PENDING', 1, 1, '2026-08-01 08:30:00', '2026-08-02 08:30:00', @company_id, @branch_id, NULL, @admin_id),
  ('AR-2026-0005', 'CORRECTION',
   (SELECT id FROM employees WHERE emp_code = '308' LIMIT 1), '2026-07-21', NULL,
   '{"inTime": "10:40"}', '{"inTime": "09:05"}', NULL,
   'Punched in at the office reader, not the gate. The gate time is the one that got recorded.',
   'APPROVED', 2, 2, '2026-07-22 09:00:00', '2026-07-23 09:00:00', @company_id, @branch_id, NULL, @admin_id);

UPDATE attendance_requests SET decided_at = '2026-07-22 15:30:00', decision_note = 'Verified against the office reader log.'
WHERE request_no = 'AR-2026-0005';

INSERT INTO attendance_request_approvals (request_id, level, approver_type, approver_role, decision, due_at)
SELECT r.id, 1, 'REPORTING_MANAGER', NULL, 'PENDING', r.due_at
FROM attendance_requests r WHERE r.status = 'PENDING';

INSERT INTO attendance_request_approvals (request_id, level, approver_type, approver_role, decision, due_at)
SELECT r.id, 2, 'HR', 'hr', 'PENDING', DATE_ADD(r.due_at, INTERVAL 2 DAY)
FROM attendance_requests r WHERE r.status = 'PENDING' AND r.total_levels = 2;

INSERT INTO attendance_request_approvals (request_id, level, approver_type, approver_role, decision, decided_by, decided_at, comments)
SELECT r.id, 1, 'REPORTING_MANAGER', NULL, 'APPROVED', @admin_id, '2026-07-22 11:00:00', 'Office reader log matches.'
FROM attendance_requests r WHERE r.request_no = 'AR-2026-0005';

INSERT INTO attendance_request_approvals (request_id, level, approver_type, approver_role, decision, decided_by, decided_at, comments)
SELECT r.id, 2, 'HR', 'hr', 'APPROVED', @hr_id, '2026-07-22 15:30:00', 'Corrected in the register.'
FROM attendance_requests r WHERE r.request_no = 'AR-2026-0005';

INSERT INTO approval_delegations (from_employee_id, to_employee_id, from_date, to_date, request_types, reason, created_by) VALUES
  ((SELECT id FROM employees WHERE emp_code = '301' LIMIT 1),
   (SELECT id FROM employees WHERE emp_code = '303' LIMIT 1),
   '2026-08-10', '2026-08-20', 'REGULARIZATION,MISSED_PUNCH,OVERTIME',
   'Annual leave cover.', @admin_id);

-- ---------------------------------------------------------------------------
-- A published roster for the first week of August.
-- ---------------------------------------------------------------------------
INSERT INTO rosters (code, name, company_id, branch_id, department_id, from_date, to_date, status, notes, published_by, published_at, created_by) VALUES
  ('ROS-2026-W32', 'Polishing floor, week 32', @company_id, @branch_id, @dept_polish, '2026-08-03', '2026-08-09',
   'PUBLISHED', 'General shift across the week with Sunday off.', @admin_id, '2026-07-31 17:00:00', @admin_id);

SET @roster_id = (SELECT id FROM rosters WHERE code = 'ROS-2026-W32' LIMIT 1);

INSERT INTO roster_entries (roster_id, employee_id, work_date, shift_id, is_week_off, planned_hours, location_id)
SELECT @roster_id, e.id, d.work_date,
       IF(DAYOFWEEK(d.work_date) = 1, NULL, e.shift_id),
       DAYOFWEEK(d.work_date) = 1,
       IF(DAYOFWEEK(d.work_date) = 1, 0, 9.00),
       @loc_polish
FROM employees e
CROSS JOIN (
  SELECT '2026-08-03' AS work_date UNION ALL SELECT '2026-08-04' UNION ALL SELECT '2026-08-05'
  UNION ALL SELECT '2026-08-06' UNION ALL SELECT '2026-08-07' UNION ALL SELECT '2026-08-08'
  UNION ALL SELECT '2026-08-09'
) d
WHERE e.work_status = 'WORKING' AND e.deleted_at IS NULL AND e.department_id = @dept_polish;

-- ---------------------------------------------------------------------------
-- Audit trail for the seeded setup, so the log is not empty on first open.
-- ---------------------------------------------------------------------------
INSERT INTO attendance_audit_logs (entity_type, entity_id, action, summary, actor_user_id, actor_role, actor_name, created_at) VALUES
  ('POLICY', @pol_factory, 'CREATE', 'Created attendance policy Factory Floor Standard', @admin_id, 'admin', 'System Administrator', '2026-01-01 09:00:00'),
  ('POLICY', @pol_night, 'CREATE', 'Created attendance policy Night Shift', @admin_id, 'admin', 'System Administrator', '2026-01-01 09:02:00'),
  ('DEVICE', @dev_gate, 'CREATE', 'Registered device Main Gate Fingerprint', @admin_id, 'admin', 'System Administrator', '2025-04-12 10:00:00'),
  ('GEOFENCE', @gf_main, 'CREATE', 'Created geofence Surat Factory Perimeter with a 250 m radius', @admin_id, 'admin', 'System Administrator', '2026-01-02 11:15:00'),
  ('ROSTER', @roster_id, 'APPROVE', 'Published roster ROS-2026-W32', @admin_id, 'admin', 'System Administrator', '2026-07-31 17:00:00');
