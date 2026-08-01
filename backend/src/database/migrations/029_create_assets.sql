-- Create asset register and assignment tables
CREATE TABLE IF NOT EXISTS assets (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  asset_code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  category ENUM('TOOL', 'MACHINE', 'DEVICE', 'FURNITURE', 'OTHER') NOT NULL DEFAULT 'TOOL',
  serial_no VARCHAR(100) NULL,
  purchase_date DATE NULL,
  purchase_cost DECIMAL(12, 2) NULL,
  status ENUM('AVAILABLE', 'ASSIGNED', 'REPAIR', 'RETIRED') NOT NULL DEFAULT 'AVAILABLE',
  created_by INT UNSIGNED NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_assets_status (status),
  INDEX idx_assets_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS asset_assignments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  asset_id INT UNSIGNED NOT NULL,
  employee_id INT UNSIGNED NOT NULL,
  assigned_on DATE NOT NULL,
  returned_on DATE NULL,
  condition_note VARCHAR(500) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_asset_assignments_employee (employee_id, returned_on),
  INDEX idx_asset_assignments_asset (asset_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
