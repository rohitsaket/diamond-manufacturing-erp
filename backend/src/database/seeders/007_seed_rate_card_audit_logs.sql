-- Seed rate card audit logs (historical entries matching the frontend static audit log)
INSERT INTO rate_card_audit_logs (actor, change_description, change_type, old_rate, new_rate, created_at) VALUES
('Accountant A', 'FANCY / GIA / 5.00–9.99 ct: ₹1,650 → ₹1,750', 'increase', 1650.00, 1750.00, '2026-01-01 10:00:00'),
('Accountant A', 'ROUND / IGI / 1.00–1.99 ct: ₹950 → ₹1,000', 'increase', 950.00, 1000.00, '2025-10-01 10:00:00'),
('Accountant B', 'BLOCKING / ANY / 0.00–1.99 ct: ₹650 → ₹700', 'increase', 650.00, 700.00, '2025-07-01 10:00:00'),
('CEO', 'All GIA rates: +8% across all buckets', 'bulk', NULL, NULL, '2025-04-01 10:00:00');
