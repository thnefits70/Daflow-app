-- Confirmado 2026-07-29: renombrado de "Gestión de Compras" a "Control de
-- Compras" para que el departamento coincida con el nuevo módulo de Control
-- de Compras. Solo actualiza el nombre visible, no el code ("COM"), así que
-- no afecta ninguna relación existente.
UPDATE "Department" SET name = 'Control de Compras' WHERE code = 'COM' AND name = 'Gestión de Compras';
