-- Seed rate card rows
SET @admin_id = (SELECT id FROM users WHERE email = 'admin@harene.com' LIMIT 1);

INSERT INTO rate_card_rows (shape_category, lab, cts_min, cts_max, rate_per_ct, effective_from, created_by) VALUES
-- ROUND / IGI
('ROUND', 'IGI', 0.00, 0.49, 800, '2024-01-01', @admin_id),
('ROUND', 'IGI', 0.50, 0.99, 900, '2024-01-01', @admin_id),
('ROUND', 'IGI', 1.00, 1.99, 1000, '2024-01-01', @admin_id),
('ROUND', 'IGI', 2.00, 2.99, 1100, '2024-01-01', @admin_id),
('ROUND', 'IGI', 3.00, 4.99, 1200, '2024-01-01', @admin_id),
('ROUND', 'IGI', 5.00, 9.99, 1300, '2024-01-01', @admin_id),
('ROUND', 'IGI', 10.00, 999.99, 1500, '2024-01-01', @admin_id),
-- ROUND / GIA
('ROUND', 'GIA', 0.00, 0.49, 950, '2024-01-01', @admin_id),
('ROUND', 'GIA', 0.50, 0.99, 1050, '2024-01-01', @admin_id),
('ROUND', 'GIA', 1.00, 1.99, 1150, '2024-01-01', @admin_id),
('ROUND', 'GIA', 2.00, 2.99, 1300, '2024-01-01', @admin_id),
('ROUND', 'GIA', 3.00, 4.99, 1450, '2024-01-01', @admin_id),
('ROUND', 'GIA', 5.00, 9.99, 1600, '2024-01-01', @admin_id),
('ROUND', 'GIA', 10.00, 999.99, 1800, '2024-01-01', @admin_id),
-- FANCY / IGI
('FANCY', 'IGI', 0.00, 0.49, 850, '2024-01-01', @admin_id),
('FANCY', 'IGI', 0.50, 0.99, 950, '2024-01-01', @admin_id),
('FANCY', 'IGI', 1.00, 1.99, 1050, '2024-01-01', @admin_id),
('FANCY', 'IGI', 2.00, 2.99, 1150, '2024-01-01', @admin_id),
('FANCY', 'IGI', 3.00, 4.99, 1250, '2024-01-01', @admin_id),
('FANCY', 'IGI', 5.00, 9.99, 1400, '2024-01-01', @admin_id),
('FANCY', 'IGI', 10.00, 999.99, 1600, '2024-01-01', @admin_id),
-- FANCY / GIA
('FANCY', 'GIA', 0.00, 0.49, 1000, '2024-01-01', @admin_id),
('FANCY', 'GIA', 0.50, 0.99, 1100, '2024-01-01', @admin_id),
('FANCY', 'GIA', 1.00, 1.99, 1200, '2024-01-01', @admin_id),
('FANCY', 'GIA', 2.00, 2.99, 1400, '2024-01-01', @admin_id),
('FANCY', 'GIA', 3.00, 4.99, 1550, '2024-01-01', @admin_id),
('FANCY', 'GIA', 5.00, 9.99, 1750, '2024-01-01', @admin_id),
('FANCY', 'GIA', 10.00, 999.99, 2000, '2024-01-01', @admin_id),
-- BLOCKING / ANY
('BLOCKING', 'ANY', 0.00, 1.99, 700, '2024-01-01', @admin_id),
('BLOCKING', 'ANY', 2.00, 4.99, 800, '2024-01-01', @admin_id),
('BLOCKING', 'ANY', 5.00, 999.99, 900, '2024-01-01', @admin_id);
