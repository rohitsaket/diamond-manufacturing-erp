-- Extend the daily attendance summary. Every existing column keeps its exact
-- meaning and the status enum is deliberately untouched: the register, payroll
-- and the dashboards all switch on it, and a new member would be silently
-- misread as unpaid. Remote work and business travel are carried by work_mode
-- instead, which nothing existing reads.
ALTER TABLE attendance_records ADD COLUMN first_in_time TIME NULL AFTER out_time;
ALTER TABLE attendance_records ADD COLUMN last_out_time TIME NULL AFTER first_in_time;
ALTER TABLE attendance_records ADD COLUMN punch_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER last_out_time;
ALTER TABLE attendance_records ADD COLUMN break_minutes INT UNSIGNED NOT NULL DEFAULT 0 AFTER punch_count;
ALTER TABLE attendance_records ADD COLUMN paid_break_minutes INT UNSIGNED NOT NULL DEFAULT 0 AFTER break_minutes;
ALTER TABLE attendance_records ADD COLUMN unpaid_break_minutes INT UNSIGNED NOT NULL DEFAULT 0 AFTER paid_break_minutes;
ALTER TABLE attendance_records ADD COLUMN gross_hours DECIMAL(5, 2) NULL AFTER worked_hours;
ALTER TABLE attendance_records ADD COLUMN expected_hours DECIMAL(5, 2) NULL AFTER gross_hours;
ALTER TABLE attendance_records ADD COLUMN deficit_hours DECIMAL(5, 2) NULL AFTER expected_hours;

-- Exceptions
ALTER TABLE attendance_records ADD COLUMN late_minutes INT UNSIGNED NOT NULL DEFAULT 0 AFTER is_late;
ALTER TABLE attendance_records ADD COLUMN is_early_exit BOOLEAN NOT NULL DEFAULT false AFTER late_minutes;
ALTER TABLE attendance_records ADD COLUMN early_exit_minutes INT UNSIGNED NOT NULL DEFAULT 0 AFTER is_early_exit;
ALTER TABLE attendance_records ADD COLUMN is_missing_punch BOOLEAN NOT NULL DEFAULT false AFTER early_exit_minutes;
ALTER TABLE attendance_records ADD COLUMN exception_flags VARCHAR(255) NULL AFTER is_missing_punch;

-- Overtime
ALTER TABLE attendance_records ADD COLUMN ot_approved_hours DECIMAL(5, 2) NOT NULL DEFAULT 0 AFTER ot_hours;
ALTER TABLE attendance_records ADD COLUMN ot_status ENUM('NONE', 'PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'NONE' AFTER ot_approved_hours;
ALTER TABLE attendance_records ADD COLUMN ot_type ENUM('NONE', 'WEEKDAY', 'WEEK_OFF', 'HOLIDAY', 'NIGHT') NOT NULL DEFAULT 'NONE' AFTER ot_status;

-- Where and how the day was worked
ALTER TABLE attendance_records ADD COLUMN work_mode ENUM('OFFICE', 'REMOTE', 'HYBRID', 'CLIENT_SITE', 'FIELD', 'WORK_SITE', 'BUSINESS_TRAVEL') NOT NULL DEFAULT 'OFFICE' AFTER shift_id;
ALTER TABLE attendance_records ADD COLUMN is_cross_day BOOLEAN NOT NULL DEFAULT false AFTER work_mode;
ALTER TABLE attendance_records ADD COLUMN shift_end_date DATE NULL AFTER is_cross_day;
ALTER TABLE attendance_records ADD COLUMN timezone VARCHAR(64) NULL AFTER shift_end_date;
ALTER TABLE attendance_records ADD COLUMN policy_id INT UNSIGNED NULL AFTER timezone;
ALTER TABLE attendance_records ADD COLUMN device_id INT UNSIGNED NULL AFTER policy_id;
ALTER TABLE attendance_records ADD COLUMN company_id INT UNSIGNED NULL AFTER device_id;
ALTER TABLE attendance_records ADD COLUMN branch_id INT UNSIGNED NULL AFTER company_id;
ALTER TABLE attendance_records ADD COLUMN department_id INT UNSIGNED NULL AFTER branch_id;

-- Approval / regularization / payroll lock
ALTER TABLE attendance_records ADD COLUMN approval_status ENUM('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'NOT_REQUIRED' AFTER department_id;
ALTER TABLE attendance_records ADD COLUMN approved_by INT UNSIGNED NULL AFTER approval_status;
ALTER TABLE attendance_records ADD COLUMN approved_at TIMESTAMP NULL AFTER approved_by;
ALTER TABLE attendance_records ADD COLUMN is_regularized BOOLEAN NOT NULL DEFAULT false AFTER approved_at;
ALTER TABLE attendance_records ADD COLUMN regularized_request_id INT UNSIGNED NULL AFTER is_regularized;
ALTER TABLE attendance_records ADD COLUMN is_locked BOOLEAN NOT NULL DEFAULT false AFTER regularized_request_id;
ALTER TABLE attendance_records ADD COLUMN locked_reason VARCHAR(255) NULL AFTER is_locked;
ALTER TABLE attendance_records ADD COLUMN recomputed_at TIMESTAMP NULL AFTER locked_reason;

-- Additive enum widening. The four original members keep their positions, so
-- every stored row and every existing comparison is unaffected.
ALTER TABLE attendance_records MODIFY COLUMN source ENUM('MANUAL', 'IMPORT', 'LEAVE_SYNC', 'SELF_PUNCH', 'WEB', 'MOBILE', 'KIOSK', 'BIOMETRIC', 'FACE', 'QR', 'NFC', 'RFID', 'AUTO', 'REGULARIZED', 'SYSTEM', 'ROSTER') NOT NULL DEFAULT 'MANUAL';

ALTER TABLE attendance_records ADD CONSTRAINT fk_att_policy FOREIGN KEY (policy_id) REFERENCES attendance_policies(id) ON DELETE SET NULL;
ALTER TABLE attendance_records ADD CONSTRAINT fk_att_device FOREIGN KEY (device_id) REFERENCES attendance_devices(id) ON DELETE SET NULL;
ALTER TABLE attendance_records ADD CONSTRAINT fk_att_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;
ALTER TABLE attendance_records ADD CONSTRAINT fk_att_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE attendance_records ADD CONSTRAINT fk_att_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE attendance_records ADD CONSTRAINT fk_att_approved_by FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL;

-- Read paths added by this module: the live board (date + status), branch and
-- department analytics, and the exception queue.
ALTER TABLE attendance_records ADD INDEX idx_att_branch_date (branch_id, att_date);
ALTER TABLE attendance_records ADD INDEX idx_att_department_date (department_id, att_date);
ALTER TABLE attendance_records ADD INDEX idx_att_emp_date_status (employee_id, att_date, status);
ALTER TABLE attendance_records ADD INDEX idx_att_ot_status (ot_status, att_date);
ALTER TABLE attendance_records ADD INDEX idx_att_approval (approval_status, att_date);
ALTER TABLE attendance_records ADD INDEX idx_att_workmode_date (work_mode, att_date);
