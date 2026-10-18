-- ============================================================
--  Menú Semanal · Esquema de la base de datos (SQLite)
--
--  Se ejecuta en cada arranque de la app. Todo usa IF NOT EXISTS,
--  así que repetirlo no borra ni duplica nada.
-- ============================================================

PRAGMA foreign_keys = ON;   -- SQLite no comprueba las claves foráneas si no se activa


-- ------------------------------------------------------------
--  Catálogos (tablas pequeñas de referencia)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS categorias (
    id      INTEGER PRIMARY KEY,
    nombre  TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS unidades (
    id           INTEGER PRIMARY KEY,
    nombre       TEXT    NOT NULL UNIQUE,
    abreviatura  TEXT    NOT NULL UNIQUE,
    entera       INTEGER NOT NULL DEFAULT 0 CHECK (entera IN (0, 1)),  -- 1 = se compra en unidades enteras
    paso         REAL    NOT NULL DEFAULT 1 CHECK (paso > 0)           -- incremento de los botones − / +
);

CREATE TABLE IF NOT EXISTS momentos (            -- desayuno, comida, cena...
    id      INTEGER PRIMARY KEY,
    nombre  TEXT    NOT NULL UNIQUE,
    orden   INTEGER NOT NULL
);


-- ------------------------------------------------------------
--  Alimentos y despensa
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS alimentos (
    id            INTEGER PRIMARY KEY,
    nombre        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    categoria_id  INTEGER REFERENCES categorias(id) ON DELETE SET NULL,
    unidad_id     INTEGER NOT NULL REFERENCES unidades(id),
    stock_minimo  REAL    NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0)
);

-- Relación 1 a 1 con alimentos: cuánto hay en casa de cada uno
CREATE TABLE IF NOT EXISTS despensa (
    alimento_id  INTEGER PRIMARY KEY REFERENCES alimentos(id) ON DELETE CASCADE,
    cantidad     REAL    NOT NULL DEFAULT 0 CHECK (cantidad >= 0),
    actualizado  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Cada alimento nuevo aparece automáticamente en la despensa con cantidad 0
CREATE TRIGGER IF NOT EXISTS trg_alimento_nuevo_en_despensa
AFTER INSERT ON alimentos
BEGIN
    INSERT INTO despensa (alimento_id) VALUES (NEW.id);
END;


-- ------------------------------------------------------------
--  Recetas (relación N a M entre recetas y alimentos)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS recetas (
    id             INTEGER PRIMARY KEY,
    nombre         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    raciones       INTEGER NOT NULL DEFAULT 2 CHECK (raciones > 0),
    instrucciones  TEXT
);

CREATE TABLE IF NOT EXISTS receta_ingredientes (
    receta_id    INTEGER NOT NULL REFERENCES recetas(id)   ON DELETE CASCADE,
    alimento_id  INTEGER NOT NULL REFERENCES alimentos(id) ON DELETE RESTRICT,  -- no se puede borrar un alimento en uso
    cantidad     REAL    NOT NULL CHECK (cantidad > 0),                         -- para las raciones de la receta
    PRIMARY KEY (receta_id, alimento_id)
);


-- ------------------------------------------------------------
--  Planificación semanal
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS menu (
    id          INTEGER PRIMARY KEY,
    fecha       TEXT    NOT NULL CHECK (fecha = date(fecha)),   -- formato AAAA-MM-DD
    momento_id  INTEGER NOT NULL REFERENCES momentos(id),
    receta_id   INTEGER NOT NULL REFERENCES recetas(id) ON DELETE CASCADE,
    raciones    INTEGER NOT NULL CHECK (raciones > 0),
    cocinado    INTEGER NOT NULL DEFAULT 0 CHECK (cocinado IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_menu_fecha ON menu (fecha);


-- ------------------------------------------------------------
--  Lista de la compra: solo se guarda lo marcado como "en el carro".
--  Lo que hay que comprar se calcula con una consulta (ver js/modelo.js).
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS compra_marcados (
    alimento_id  INTEGER PRIMARY KEY REFERENCES alimentos(id) ON DELETE CASCADE
);


-- ------------------------------------------------------------
--  Vistas
-- ------------------------------------------------------------

CREATE VIEW IF NOT EXISTS v_despensa AS
SELECT a.id,
       a.nombre,
       a.categoria_id,
       COALESCE(c.nombre, 'Sin categoría') AS categoria,
       a.unidad_id,
       u.abreviatura                       AS unidad,
       u.entera,
       u.paso,
       d.cantidad,
       a.stock_minimo,
       d.actualizado,
       (d.cantidad < a.stock_minimo)       AS bajo_minimo
FROM alimentos a
JOIN despensa  d ON d.alimento_id = a.id
JOIN unidades  u ON u.id = a.unidad_id
LEFT JOIN categorias c ON c.id = a.categoria_id;
