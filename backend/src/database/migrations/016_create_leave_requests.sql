-- Create leave requests table (apply / approve / reject workflow)
CREATE TABLE IF NOT EXISTS leave_requests (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  leave_type_id INT UNSIGNED NOT NULL,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  days DECIMAL(5, 1) NOT NULL,
  reason VARCHAR(500) NULL,
  status ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  applied_by_self BOOLEAN NOT NULL DEFAULT false,
  decided_by INT UNSIGNED NULL,
  decided_at DATETIME NULL,
  decision_note VARCHAR(500) NULL,
  created_by INT UNSIGNED NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (leave_type_id) REFERENCES leave_types(id),
  FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_leave_requests_employee (employee_id, status),
  INDEX idx_leave_requests_status (status),
  INDEX idx_leave_requests_dates (from_date, to_date),
  INDEX idx_leave_requests_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS leave_balances (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  leave_type_id INT UNSIGNED NOT NULL,
  year SMALLINT UNSIGNED NOT NULL,
  allocated DECIMAL(5, 1) NOT NULL DEFAULT 0,
  used DECIMAL(5, 1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (leave_type_id) REFERENCES leave_types(id) ON DELETE CASCADE,
  UNIQUE KEY uk_leave_balance (employee_id, leave_type_id, year),
  INDEX idx_leave_balances_year (year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
