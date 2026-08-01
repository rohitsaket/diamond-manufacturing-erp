-- Seed labour heads
INSERT INTO labour_heads (code, name, is_active) VALUES
('FULL_POLISHED', 'Full Polished', true),
('BLOCKING', 'Blocking', true),
('HPHT', 'HPHT', true),
('REPAIRING', 'Repairing', true),
('TRANSFER', 'Transfer', true),
('DAMAGED', 'Damaged', true)
ON DUPLICATE KEY UPDATE name = VALUES(name);
