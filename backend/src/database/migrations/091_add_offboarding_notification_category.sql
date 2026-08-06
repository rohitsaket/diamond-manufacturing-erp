-- Additive: offboarding events need their own notification category.
ALTER TABLE notifications MODIFY category ENUM('LEAVE', 'ATTENDANCE', 'PAYROLL', 'TRAINING', 'POLICY', 'SECURITY', 'SYSTEM', 'RECRUITMENT', 'EXPENSE', 'TASK', 'HELPDESK', 'ASSET', 'PERFORMANCE', 'OFFBOARDING') NOT NULL DEFAULT 'SYSTEM';
