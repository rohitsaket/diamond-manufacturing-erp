-- Extend salary lines with earning components, statutory deductions and net pay
-- total_amount is retained and kept equal to gross_amount for backward compatibility
ALTER TABLE salary_lines ADD COLUMN worker_type ENUM('PIECE_RATE', 'DHAR', 'MAXI') NULL;
ALTER TABLE salary_lines ADD COLUMN paid_days DECIMAL(6, 2) NOT NULL DEFAULT 0;
ALTER TABLE salary_lines ADD COLUMN period_days INT UNSIGNED NOT NULL DEFAULT 0;
ALTER TABLE salary_lines ADD COLUMN present_days DECIMAL(6, 2) NOT NULL DEFAULT 0;
ALTER TABLE salary_lines ADD COLUMN absent_days DECIMAL(6, 2) NOT NULL DEFAULT 0;
ALTER TABLE salary_lines ADD COLUMN leave_days DECIMAL(6, 2) NOT NULL DEFAULT 0;
ALTER TABLE salary_lines ADD COLUMN ot_hours DECIMAL(6, 2) NOT NULL DEFAULT 0;
ALTER TABLE salary_lines ADD COLUMN earn_piece DECIMAL(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE salary_lines ADD COLUMN earn_fixed DECIMAL(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE salary_lines ADD COLUMN earn_ot DECIMAL(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE salary_lines ADD COLUMN gross_amount DECIMAL(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE salary_lines ADD COLUMN ded_pf DECIMAL(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE salary_lines ADD COLUMN ded_esi DECIMAL(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE salary_lines ADD COLUMN ded_pt DECIMAL(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE salary_lines ADD COLUMN ded_advance DECIMAL(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE salary_lines ADD COLUMN ded_other DECIMAL(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE salary_lines ADD COLUMN total_deductions DECIMAL(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE salary_lines ADD COLUMN net_amount DECIMAL(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE salary_lines ADD COLUMN recalculated_at DATETIME NULL;
UPDATE salary_lines SET gross_amount = total_amount, net_amount = total_amount WHERE gross_amount = 0;
