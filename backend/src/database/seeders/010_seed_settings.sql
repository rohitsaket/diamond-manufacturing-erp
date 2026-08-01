-- Seed application settings
SET @admin_id = (SELECT id FROM users WHERE email = 'admin@harene.com' LIMIT 1);

INSERT INTO settings (`key`, `value`, description, updated_by) VALUES
('company_name', 'Harene Diamond Manufacturing', 'Company display name', @admin_id),
('company_address', 'Surat, Gujarat, India', 'Company address', @admin_id),
('yield_target_pct', '68', 'Target yield percentage for KPI gauges', @admin_id),
('lot_sla_days', '18', 'Default SLA days for lot processing', @admin_id),
('leakage_flag_threshold_pct', '5.0', 'Percentage threshold to flag leakage exceptions', @admin_id),
('leakage_flag_weight_ratio', '0.35', 'Weight ratio threshold for leakage flagging', @admin_id),
('app_version', '2.0', 'Application version label', @admin_id)
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`);
