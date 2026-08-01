-- Seed work shifts
SET @admin_id = (SELECT id FROM users WHERE email = 'admin@harene.com' LIMIT 1);

INSERT INTO shifts (name, start_time, end_time, break_minutes, grace_minutes, week_off_day, is_default, created_by) VALUES
('General Shift', '09:00:00', '19:00:00', 60, 15, 0, true, @admin_id),
('Early Shift', '08:00:00', '17:00:00', 45, 10, 0, false, @admin_id),
('Evening Shift', '13:00:00', '22:00:00', 45, 15, 0, false, @admin_id)
ON DUPLICATE KEY UPDATE start_time = VALUES(start_time);

-- Put every working employee on the general shift by default
SET @general_shift = (SELECT id FROM shifts WHERE name = 'General Shift' LIMIT 1);
UPDATE employees SET shift_id = @general_shift WHERE shift_id IS NULL AND deleted_at IS NULL;
