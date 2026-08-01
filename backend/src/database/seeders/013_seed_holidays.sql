-- Seed the 2026 holiday calendar (Gujarat / Surat diamond unit)
SET @admin_id = (SELECT id FROM users WHERE email = 'admin@harene.com' LIMIT 1);

INSERT INTO holidays (holiday_date, name, year_hint, is_optional, created_by) VALUES
('2026-01-14', 'Uttarayan (Makar Sankranti)', 2026, false, @admin_id),
('2026-01-15', 'Vasi Uttarayan', 2026, false, @admin_id),
('2026-01-26', 'Republic Day', 2026, false, @admin_id),
('2026-03-04', 'Holi', 2026, false, @admin_id),
('2026-03-21', 'Ramzan Eid', 2026, true, @admin_id),
('2026-08-15', 'Independence Day', 2026, false, @admin_id),
('2026-08-28', 'Raksha Bandhan', 2026, false, @admin_id),
('2026-09-05', 'Janmashtami', 2026, false, @admin_id),
('2026-10-02', 'Gandhi Jayanti', 2026, false, @admin_id),
('2026-10-20', 'Dussehra', 2026, false, @admin_id),
('2026-11-08', 'Diwali', 2026, false, @admin_id),
('2026-11-09', 'New Year (Bestu Varas)', 2026, false, @admin_id),
('2026-11-10', 'Bhai Dooj', 2026, false, @admin_id),
('2026-12-25', 'Christmas', 2026, true, @admin_id)
ON DUPLICATE KEY UPDATE name = VALUES(name);
