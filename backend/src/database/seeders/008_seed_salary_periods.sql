-- Seed salary periods
SET @admin_id = (SELECT id FROM users WHERE email = 'admin@harene.com' LIMIT 1);

INSERT INTO salary_periods (label, from_date, to_date, status, created_by) VALUES
('July 2026', '2026-07-01', '2026-07-31', 'OPEN', @admin_id),
('June 2026', '2026-06-01', '2026-06-30', 'PAID', @admin_id),
('May 2026', '2026-05-01', '2026-05-31', 'PAID', @admin_id);
