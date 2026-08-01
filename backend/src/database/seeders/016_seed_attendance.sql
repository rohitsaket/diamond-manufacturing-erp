-- Seed a full July 2026 attendance register for every working employee.
-- Dates are generated from a 31-row numbers table so the register is complete.
SET @admin_id = (SELECT id FROM users WHERE email = 'admin@harene.com' LIMIT 1);
SET @general_shift = (SELECT id FROM shifts WHERE name = 'General Shift' LIMIT 1);

INSERT INTO attendance_records
  (employee_id, att_date, status, shift_id, in_time, out_time, worked_hours, ot_hours, is_late, source, remarks, created_by, updated_by)
SELECT
  e.id,
  d.dt,
  CASE
    WHEN DAYOFWEEK(d.dt) = 1 THEN 'WEEK_OFF'
    WHEN h.holiday_date IS NOT NULL THEN 'HOLIDAY'
    WHEN MOD(e.id * 7 + DAYOFMONTH(d.dt), 23) = 0 THEN 'ABSENT'
    WHEN MOD(e.id * 5 + DAYOFMONTH(d.dt), 19) = 0 THEN 'HALF_DAY'
    ELSE 'PRESENT'
  END,
  @general_shift,
  CASE WHEN DAYOFWEEK(d.dt) = 1 OR h.holiday_date IS NOT NULL THEN NULL ELSE '09:05:00' END,
  CASE WHEN DAYOFWEEK(d.dt) = 1 OR h.holiday_date IS NOT NULL THEN NULL ELSE '19:10:00' END,
  CASE WHEN DAYOFWEEK(d.dt) = 1 OR h.holiday_date IS NOT NULL THEN NULL ELSE 9.00 END,
  CASE WHEN DAYOFWEEK(d.dt) IN (1) OR h.holiday_date IS NOT NULL THEN 0
       WHEN MOD(e.id + DAYOFMONTH(d.dt), 11) = 0 THEN 2.00
       WHEN MOD(e.id + DAYOFMONTH(d.dt), 7) = 0 THEN 1.00
       ELSE 0 END,
  false,
  'MANUAL',
  NULL,
  @admin_id,
  @admin_id
FROM employees e
CROSS JOIN (
  SELECT DATE_ADD('2026-07-01', INTERVAL n DAY) AS dt FROM (
    SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
    UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9
    UNION ALL SELECT 10 UNION ALL SELECT 11 UNION ALL SELECT 12 UNION ALL SELECT 13 UNION ALL SELECT 14
    UNION ALL SELECT 15 UNION ALL SELECT 16 UNION ALL SELECT 17 UNION ALL SELECT 18 UNION ALL SELECT 19
    UNION ALL SELECT 20 UNION ALL SELECT 21 UNION ALL SELECT 22 UNION ALL SELECT 23 UNION ALL SELECT 24
    UNION ALL SELECT 25 UNION ALL SELECT 26 UNION ALL SELECT 27 UNION ALL SELECT 28 UNION ALL SELECT 29
    UNION ALL SELECT 30
  ) days
) d
LEFT JOIN holidays h ON h.holiday_date = d.dt AND h.deleted_at IS NULL
WHERE e.work_status = 'WORKING'
  AND e.deleted_at IS NULL
  AND e.joined_at <= d.dt
ON DUPLICATE KEY UPDATE status = VALUES(status), ot_hours = VALUES(ot_hours);
