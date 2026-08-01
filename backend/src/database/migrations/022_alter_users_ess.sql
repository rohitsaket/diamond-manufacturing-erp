-- Extend users for employee self-service logins and dashboard preferences
-- Existing roles are preserved; 'employee' is appended for worker self-service
ALTER TABLE users MODIFY COLUMN role ENUM('admin', 'manager', 'operator', 'accountant', 'hr', 'employee') NOT NULL DEFAULT 'operator';
ALTER TABLE users ADD COLUMN employee_id INT UNSIGNED NULL;
ALTER TABLE users ADD COLUMN phone VARCHAR(20) NULL;
ALTER TABLE users ADD COLUMN avatar_url VARCHAR(500) NULL;
ALTER TABLE users ADD COLUMN theme ENUM('light', 'dark', 'system') NOT NULL DEFAULT 'light';
ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD CONSTRAINT fk_users_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE users ADD INDEX idx_users_employee (employee_id);
