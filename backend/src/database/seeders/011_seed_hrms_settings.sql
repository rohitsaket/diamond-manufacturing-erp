-- Seed HRMS statutory and attendance settings
SET @admin_id = (SELECT id FROM users WHERE email = 'admin@harene.com' LIMIT 1);

INSERT INTO settings (`key`, `value`, description, updated_by) VALUES
('pf_enabled', 'true', 'Master toggle for employee provident fund deduction', @admin_id),
('pf_employee_rate_pct', '12', 'Employee PF contribution rate (percent of PF wage)', @admin_id),
('pf_wage_ceiling', '15000', 'Monthly wage ceiling for PF calculation (INR)', @admin_id),
('esi_enabled', 'true', 'Master toggle for ESI deduction', @admin_id),
('esi_employee_rate_pct', '0.75', 'Employee ESI contribution rate (percent of gross)', @admin_id),
('esi_gross_ceiling', '21000', 'Gross salary ceiling for ESI eligibility (INR)', @admin_id),
('pt_enabled', 'true', 'Master toggle for professional tax deduction', @admin_id),
('pt_slabs_json', '[{"upTo":11999,"amount":0},{"upTo":24999,"amount":150},{"upTo":null,"amount":200}]', 'Professional tax slabs (Gujarat defaults) as JSON', @admin_id),
('ot_rate_per_hour', '60', 'Flat overtime rate per hour (INR)', @admin_id),
('attendance_full_day_hours', '7', 'Worked hours at or above which a punch counts as a full day', @admin_id),
('attendance_half_day_hours', '4', 'Worked hours at or above which a punch counts as a half day', @admin_id),
('ot_min_minutes', '30', 'Minimum minutes past shift end before overtime is credited', @admin_id)
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`);
