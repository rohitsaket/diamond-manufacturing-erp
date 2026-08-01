-- Create advances and loans table with installment recovery tracking
CREATE TABLE IF NOT EXISTS advances (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  advance_type ENUM('ADVANCE', 'LOAN') NOT NULL DEFAULT 'ADVANCE',
  amount DECIMAL(12, 2) NOT NULL,
  advance_date DATE NOT NULL,
  reason VARCHAR(500) NULL,
  installment_amount DECIMAL(12, 2) NOT NULL,
  status ENUM('ACTIVE', 'CLOSED', 'WRITTEN_OFF') NOT NULL DEFAULT 'ACTIVE',
  closed_at DATETIME NULL,
  created_by INT UNSIGNED NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_advances_employee (employee_id, status),
  INDEX idx_advances_status (status),
  INDEX idx_advances_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS advance_recoveries (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  advance_id INT UNSIGNED NOT NULL,
  period_id INT UNSIGNED NULL,
  salary_line_id INT UNSIGNED NULL,
  amount DECIMAL(12, 2) NOT NULL,
  recovered_on DATE NOT NULL,
  source ENUM('PAYROLL', 'MANUAL') NOT NULL DEFAULT 'PAYROLL',
  remarks VARCHAR(255) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (advance_id) REFERENCES advances(id) ON DELETE CASCADE,
  FOREIGN KEY (period_id) REFERENCES salary_periods(id) ON DELETE SET NULL,
  FOREIGN KEY (salary_line_id) REFERENCES salary_lines(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_recoveries_advance (advance_id),
  INDEX idx_recoveries_period (period_id, source)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
