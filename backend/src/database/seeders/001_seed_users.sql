-- Seed users with default admin/manager accounts
-- Password for all: admin123 (bcrypt hash)
INSERT INTO users (email, password_hash, name, role, is_active) VALUES
('admin@harene.com', '$2a$10$gEykpyegqPAcGVha8tRH6ejHWzxU0mj6tE.1txUMu.u6/72cLX0Oy', 'Admin User', 'admin', true),
('manager@harene.com', '$2a$10$gEykpyegqPAcGVha8tRH6ejHWzxU0mj6tE.1txUMu.u6/72cLX0Oy', 'Manager User', 'manager', true),
('accountant@harene.com', '$2a$10$gEykpyegqPAcGVha8tRH6ejHWzxU0mj6tE.1txUMu.u6/72cLX0Oy', 'Accountant A', 'accountant', true),
('operator@harene.com', '$2a$10$gEykpyegqPAcGVha8tRH6ejHWzxU0mj6tE.1txUMu.u6/72cLX0Oy', 'Operator User', 'operator', true)
ON DUPLICATE KEY UPDATE name = VALUES(name);
