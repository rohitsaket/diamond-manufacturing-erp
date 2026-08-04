-- Extend salary_lines for the component-driven engine. Every existing column
-- keeps its meaning; total_amount stays equal to gross_amount for compatibility.
ALTER TABLE salary_lines ADD COLUMN run_id INT UNSIGNED NULL;
ALTER TABLE salary_lines ADD COLUMN structure_id INT UNSIGNED NULL;
ALTER TABLE salary_lines ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'INR';
ALTER TABLE salary_lines ADD COLUMN exchange_rate DECIMAL(14, 6) NOT NULL DEFAULT 1;
ALTER TABLE salary_lines ADD COLUMN lop_days DECIMAL(6, 2) NOT NULL DEFAULT 0;
ALTER TABLE salary_lines ADD COLUMN payable_days DECIMAL(6, 2) NOT NULL DEFAULT 0;
ALTER TABLE salary_lines ADD COLUMN earn_bonus DECIMAL(14, 2) NOT NULL DEFAULT 0;
ALTER TABLE salary_lines ADD COLUMN earn_incentive DECIMAL(14, 2) NOT NULL DEFAULT 0;
ALTER TABLE salary_lines ADD COLUMN earn_variable DECIMAL(14, 2) NOT NULL DEFAULT 0;
ALTER TABLE salary_lines ADD COLUMN earn_arrears DECIMAL(14, 2) NOT NULL DEFAULT 0;
ALTER TABLE salary_lines ADD COLUMN earn_reimbursement DECIMAL(14, 2) NOT NULL DEFAULT 0;
ALTER TABLE salary_lines ADD COLUMN ded_income_tax DECIMAL(14, 2) NOT NULL DEFAULT 0;
ALTER TABLE salary_lines ADD COLUMN ded_loan DECIMAL(14, 2) NOT NULL DEFAULT 0;
ALTER TABLE salary_lines ADD COLUMN ded_lwf DECIMAL(14, 2) NOT NULL DEFAULT 0;
ALTER TABLE salary_lines ADD COLUMN ded_insurance DECIMAL(14, 2) NOT NULL DEFAULT 0;
ALTER TABLE salary_lines ADD COLUMN employer_pf DECIMAL(14, 2) NOT NULL DEFAULT 0;
ALTER TABLE salary_lines ADD COLUMN employer_esi DECIMAL(14, 2) NOT NULL DEFAULT 0;
ALTER TABLE salary_lines ADD COLUMN employer_cost DECIMAL(14, 2) NOT NULL DEFAULT 0;
ALTER TABLE salary_lines ADD COLUMN taxable_income DECIMAL(14, 2) NOT NULL DEFAULT 0;
ALTER TABLE salary_lines ADD COLUMN payment_status ENUM('UNPAID', 'QUEUED', 'PAID', 'FAILED', 'ON_HOLD') NOT NULL DEFAULT 'UNPAID';
ALTER TABLE salary_lines ADD COLUMN payment_reference VARCHAR(120) NULL;
ALTER TABLE salary_lines ADD COLUMN payment_failed_reason VARCHAR(255) NULL;
ALTER TABLE salary_lines ADD COLUMN is_final_settlement BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE salary_lines ADD COLUMN remarks VARCHAR(500) NULL;
ALTER TABLE salary_lines ADD CONSTRAINT fk_lines_run FOREIGN KEY (run_id) REFERENCES payroll_runs(id) ON DELETE SET NULL;
ALTER TABLE salary_lines ADD CONSTRAINT fk_lines_structure FOREIGN KEY (structure_id) REFERENCES salary_structures(id) ON DELETE SET NULL;
ALTER TABLE salary_lines ADD INDEX idx_lines_run (run_id);
ALTER TABLE salary_lines ADD INDEX idx_lines_payment_status (payment_status);

-- The per-component breakdown behind every payslip line.
CREATE TABLE IF NOT EXISTS salary_line_components (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  salary_line_id INT UNSIGNED NOT NULL,
  component_id INT UNSIGNED NULL,
  component_code VARCHAR(40) NOT NULL,
  component_name VARCHAR(160) NOT NULL,
  component_type ENUM('EARNING', 'DEDUCTION', 'EMPLOYER_CONTRIBUTION', 'REIMBURSEMENT') NOT NULL,
  category VARCHAR(40) NULL,
  amount DECIMAL(14, 2) NOT NULL DEFAULT 0,
  base_amount DECIMAL(14, 2) NULL,
  percent_applied DECIMAL(7, 4) NULL,
  is_taxable BOOLEAN NOT NULL DEFAULT true,
  is_prorated BOOLEAN NOT NULL DEFAULT false,
  display_order INT UNSIGNED NOT NULL DEFAULT 100,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (salary_line_id) REFERENCES salary_lines(id) ON DELETE CASCADE,
  FOREIGN KEY (component_id) REFERENCES pay_components(id) ON DELETE SET NULL,
  INDEX idx_line_components_line (salary_line_id),
  INDEX idx_line_components_code (component_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
