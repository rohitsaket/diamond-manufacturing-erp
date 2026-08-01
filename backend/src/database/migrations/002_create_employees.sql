-- Create employees table (karigars/workers)
CREATE TABLE IF NOT EXISTS employees (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  emp_code VARCHAR(50) NOT NULL UNIQUE,
  full_name VARCHAR(255) NOT NULL,
  short_name VARCHAR(100) NOT NULL,
  grade VARCHAR(20) NOT NULL,
  worker_type ENUM('PIECE_RATE', 'DHAR', 'MAXI') NOT NULL,
  work_status ENUM('WORKING', 'RESIGN') NOT NULL DEFAULT 'WORKING',
  whatsapp VARCHAR(20) NULL,
  joined_at DATE NOT NULL,
  resigned_at DATE NULL,
  created_by INT UNSIGNED NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_employees_work_status (work_status),
  INDEX idx_employees_worker_type (worker_type),
  INDEX idx_employees_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create employee specialists junction table
CREATE TABLE IF NOT EXISTS employee_specialists (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  specialist_code VARCHAR(10) NOT NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  UNIQUE KEY uk_employee_specialist (employee_id, specialist_code),
  INDEX idx_specialist_code (specialist_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
