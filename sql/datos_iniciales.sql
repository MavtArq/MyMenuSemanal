-- ============================================================
--  Datos iniciales. Solo se cargan la primera vez que se crea la
--  base de datos (cuando PRAGMA user_version vale 0).
-- ============================================================

INSERT INTO categorias (nombre) VALUES
    ('Frutas y verduras'),
    ('Carnes'),
    ('Pescados'),
    ('Lácteos y huevos'),
    ('Panadería'),
    ('Despensa seca'),
    ('Congelados'),
    ('Bebidas'),
    ('Limpieza e higiene'),
    ('Otros');

INSERT INTO unidades (nombre, abreviatura, entera, paso) VALUES
    ('Gramos',      'g',   0, 100),
    ('Kilogramos',  'kg',  0, 0.5),
    ('Mililitros',  'ml',  0, 100),
    ('Litros',      'l',   0, 0.5),
    ('Unidades',    'ud',  1, 1),
    ('Paquetes',    'paq', 1, 1);

INSERT INTO momentos (nombre, orden) VALUES
    ('Desayuno', 1),
    ('Comida',   2),
    ('Cena',     3);
