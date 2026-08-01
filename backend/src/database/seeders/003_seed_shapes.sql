-- Seed shapes with their categories
INSERT INTO shapes (name, shape_category) VALUES
('Round', 'ROUND'),
('Emerald', 'FANCY'),
('Radiant', 'FANCY'),
('Pear', 'FANCY'),
('Oval', 'FANCY'),
('Cushion', 'FANCY'),
('Princess', 'FANCY'),
('Marquise', 'FANCY'),
('Heart', 'FANCY'),
('Asscher', 'FANCY')
ON DUPLICATE KEY UPDATE name = VALUES(name);
