-- Seed an HR staff login and self-service logins for a few karigars.
-- Password for every seeded account is admin123; ESS accounts are flagged to
-- force a password change on first login.
INSERT INTO users (email, password_hash, name, role, is_active) VALUES
('hr@harene.com', '$2a$10$gEykpyegqPAcGVha8tRH6ejHWzxU0mj6tE.1txUMu.u6/72cLX0Oy', 'HR Manager', 'hr', true)
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO users (email, password_hash, name, role, employee_id, phone, is_active, must_change_password)
SELECT
  CONCAT(LOWER(e.emp_code), '@ess.local'),
  '$2a$10$gEykpyegqPAcGVha8tRH6ejHWzxU0mj6tE.1txUMu.u6/72cLX0Oy',
  e.full_name,
  'employee',
  e.id,
  e.whatsapp,
  true,
  true
FROM employees e
WHERE e.work_status = 'WORKING'
  AND e.deleted_at IS NULL
  AND e.emp_code IN ('301', '302', '303', 'DHAR-401')
ON DUPLICATE KEY UPDATE name = VALUES(name), employee_id = VALUES(employee_id);
