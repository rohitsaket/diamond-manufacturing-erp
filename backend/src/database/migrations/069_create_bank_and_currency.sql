-- Currencies and exchange rates. Everything defaults to INR at rate 1, so a
-- single-currency install behaves exactly as before.
CREATE TABLE IF NOT EXISTS currencies (
  code CHAR(3) NOT NULL PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  symbol VARCHAR(8) NOT NULL,
  decimal_places TINYINT UNSIGNED NOT NULL DEFAULT 2,
  is_base BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS exchange_rates (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  from_currency CHAR(3) NOT NULL,
  to_currency CHAR(3) NOT NULL,
  rate DECIMAL(18, 8) NOT NULL,
  effective_date DATE NOT NULL,
  source VARCHAR(60) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uk_rate_pair_date (from_currency, to_currency, effective_date),
  INDEX idx_rates_date (effective_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Company bank accounts money is disbursed from.
CREATE TABLE IF NOT EXISTS company_bank_accounts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  label VARCHAR(160) NOT NULL,
  bank_name VARCHAR(160) NOT NULL,
  account_number VARCHAR(40) NOT NULL,
  ifsc VARCHAR(15) NULL,
  branch VARCHAR(160) NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  company VARCHAR(160) NULL,
-- Export layout: banks each want their own column order.
  file_format ENUM('NEFT', 'RTGS', 'IMPS', 'ACH', 'GENERIC_CSV') NOT NULL DEFAULT 'NEFT',
  corporate_id VARCHAR(60) NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_bank_accounts_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A payment batch is one bank file / disbursement instruction.
CREATE TABLE IF NOT EXISTS payment_batches (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  batch_no VARCHAR(40) NOT NULL UNIQUE,
  period_id INT UNSIGNED NULL,
  run_id INT UNSIGNED NULL,
  bank_account_id INT UNSIGNED NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  payment_mode ENUM('NEFT', 'RTGS', 'IMPS', 'CASH', 'CHEQUE', 'ACH') NOT NULL DEFAULT 'NEFT',
  value_date DATE NULL,
  total_records INT UNSIGNED NOT NULL DEFAULT 0,
  total_amount DECIMAL(16, 2) NOT NULL DEFAULT 0,
  success_count INT UNSIGNED NOT NULL DEFAULT 0,
  failed_count INT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('DRAFT', 'GENERATED', 'SENT', 'PROCESSING', 'COMPLETED', 'PARTIALLY_FAILED', 'FAILED', 'CANCELLED')
    NOT NULL DEFAULT 'DRAFT',
  file_name VARCHAR(255) NULL,
  generated_at DATETIME NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (period_id) REFERENCES salary_periods(id) ON DELETE SET NULL,
  FOREIGN KEY (run_id) REFERENCES payroll_runs(id) ON DELETE SET NULL,
  FOREIGN KEY (bank_account_id) REFERENCES company_bank_accounts(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_batches_period (period_id),
  INDEX idx_batches_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_batch_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  batch_id INT UNSIGNED NOT NULL,
  salary_line_id INT UNSIGNED NULL,
  employee_id INT UNSIGNED NOT NULL,
  beneficiary_name VARCHAR(200) NOT NULL,
  account_number VARCHAR(40) NULL,
  ifsc VARCHAR(15) NULL,
  amount DECIMAL(14, 2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  status ENUM('PENDING', 'SENT', 'SUCCESS', 'FAILED', 'RETURNED') NOT NULL DEFAULT 'PENDING',
  utr_reference VARCHAR(60) NULL,
  failure_reason VARCHAR(255) NULL,
-- Pre-flight validation result, so bad account details never reach the bank.
  validation_status ENUM('VALID', 'MISSING_ACCOUNT', 'MISSING_IFSC', 'INVALID_IFSC', 'ZERO_AMOUNT')
    NOT NULL DEFAULT 'VALID',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (batch_id) REFERENCES payment_batches(id) ON DELETE CASCADE,
  FOREIGN KEY (salary_line_id) REFERENCES salary_lines(id) ON DELETE SET NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  INDEX idx_batch_items_batch (batch_id, status),
  INDEX idx_batch_items_employee (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
