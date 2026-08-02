-- Cost and profit centres.
CREATE TABLE IF NOT EXISTS cost_center_groups (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id INT UNSIGNED NOT NULL,
  code VARCHAR(30) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  description VARCHAR(500) NULL,
  status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_ccgroup_company (company_id),
  INDEX idx_ccgroup_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cost_centers (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id INT UNSIGNED NOT NULL,
  group_id INT UNSIGNED NULL,
  code VARCHAR(30) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  center_type ENUM('COST', 'PROFIT', 'EXPENSE', 'INVESTMENT') NOT NULL DEFAULT 'COST',
  parent_cost_center_id INT UNSIGNED NULL,
  owner_employee_id INT UNSIGNED NULL,
  department_id INT UNSIGNED NULL,
  branch_id INT UNSIGNED NULL,
  gl_account VARCHAR(40) NULL,
  annual_budget DECIMAL(16, 2) NULL,
  budget_currency CHAR(3) NOT NULL DEFAULT 'INR',
  fiscal_year VARCHAR(12) NULL,
  status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_by INT UNSIGNED NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES cost_center_groups(id) ON DELETE SET NULL,
  FOREIGN KEY (parent_cost_center_id) REFERENCES cost_centers(id) ON DELETE SET NULL,
  FOREIGN KEY (owner_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_cc_company (company_id),
  INDEX idx_cc_group (group_id),
  INDEX idx_cc_parent (parent_cost_center_id),
  INDEX idx_cc_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE departments ADD CONSTRAINT fk_dept_cost_center FOREIGN KEY (cost_center_id) REFERENCES cost_centers(id) ON DELETE SET NULL;
