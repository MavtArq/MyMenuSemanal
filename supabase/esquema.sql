-- ============================================================
--  Menú Semanal · Esquema para Supabase (PostgreSQL)
--
--  Cómo usarlo: Supabase → SQL Editor → New query → pega todo
--  este fichero → Run. Se puede ejecutar varias veces sin
--  perder datos (todo es "if not exists" / "or replace").
--
--  Seguridad: cada familia es un "hogar". Las reglas RLS (Row
--  Level Security) hacen que cada usuario solo pueda leer y
--  modificar las filas de su propio hogar. La protección está
--  en la base de datos, no en la app.
-- ============================================================


-- ------------------------------------------------------------
--  Catálogos compartidos por todos (solo lectura)
-- ------------------------------------------------------------

create table if not exists public.categorias (
    id      smallint generated always as identity primary key,
    nombre  text not null unique
);

create table if not exists public.unidades (
    id           smallint generated always as identity primary key,
    nombre       text    not null unique,
    abreviatura  text    not null unique,
    entera       boolean not null default false,          -- se compra en unidades enteras
    paso         numeric not null default 1 check (paso > 0)   -- incremento de los botones − / +
);

create table if not exists public.momentos (
    id      smallint generated always as identity primary key,
    nombre  text     not null unique,
    orden   smallint not null
);

insert into public.categorias (nombre) values
    ('Frutas y verduras'), ('Carnes'), ('Pescados'), ('Lácteos y huevos'), ('Panadería'),
    ('Despensa seca'), ('Congelados'), ('Bebidas'), ('Limpieza e higiene'), ('Otros')
on conflict (nombre) do nothing;

insert into public.unidades (nombre, abreviatura, entera, paso) values
    ('Gramos', 'g', false, 100), ('Kilogramos', 'kg', false, 0.5),
    ('Mililitros', 'ml', false, 100), ('Litros', 'l', false, 0.5),
    ('Unidades', 'ud', true, 1), ('Paquetes', 'paq', true, 1)
on conflict (nombre) do nothing;

insert into public.momentos (nombre, orden) values
    ('Desayuno', 1), ('Comida', 2), ('Cena', 3)
on conflict (nombre) do nothing;


-- ------------------------------------------------------------
--  Hogares y miembros
-- ------------------------------------------------------------

create table if not exists public.hogares (
    id                 uuid primary key default gen_random_uuid(),
    nombre             text not null check (length(trim(nombre)) between 1 and 60),
    codigo_invitacion  text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 8)),
    creado             timestamptz not null default now()
);

create table if not exists public.miembros (
    user_id   uuid primary key references auth.users(id) on delete cascade,   -- un usuario, un hogar
    hogar_id  uuid not null references public.hogares(id) on delete cascade,
    email     text,
    unido     timestamptz not null default now()
);
create index if not exists miembros_hogar_idx on public.miembros (hogar_id);

-- Hogar del usuario que hace la consulta. Es "security definer" para poder
-- leer miembros sin que su propia regla RLS entre en bucle.
create or replace function public.mi_hogar()
returns uuid
language sql stable security definer set search_path = ''
as $$
    select hogar_id from public.miembros where user_id = auth.uid()
$$;


-- ------------------------------------------------------------
--  Alimentos y despensa
-- ------------------------------------------------------------

create table if not exists public.alimentos (
    id            bigint generated always as identity primary key,
    hogar_id      uuid not null default public.mi_hogar() references public.hogares(id) on delete cascade,
    nombre        text not null check (length(trim(nombre)) between 1 and 60),
    categoria_id  smallint references public.categorias(id) on delete set null,
    unidad_id     smallint not null references public.unidades(id),
    stock_minimo  numeric not null default 0 check (stock_minimo >= 0)
);
-- El nombre no se repite dentro de un hogar (sin distinguir mayúsculas)
create unique index if not exists alimentos_nombre_unico on public.alimentos (hogar_id, lower(nombre));

-- Relación 1 a 1 con alimentos: cuánto hay en casa
create table if not exists public.despensa (
    alimento_id  bigint primary key references public.alimentos(id) on delete cascade,
    cantidad     numeric not null default 0 check (cantidad >= 0),
    actualizado  timestamptz not null default now()
);

create or replace function public.crear_fila_despensa()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
    insert into public.despensa (alimento_id) values (new.id);
    return new;
end
$$;

drop trigger if exists trg_alimento_nuevo_en_despensa on public.alimentos;
create trigger trg_alimento_nuevo_en_despensa
    after insert on public.alimentos
    for each row execute function public.crear_fila_despensa();


-- ------------------------------------------------------------
--  Recetas (N a M con alimentos)
-- ------------------------------------------------------------

create table if not exists public.recetas (
    id             bigint generated always as identity primary key,
    hogar_id       uuid not null default public.mi_hogar() references public.hogares(id) on delete cascade,
    nombre         text not null check (length(trim(nombre)) between 1 and 80),
    raciones       integer not null default 2 check (raciones > 0),
    instrucciones  text
);
create unique index if not exists recetas_nombre_unico on public.recetas (hogar_id, lower(nombre));

create table if not exists public.receta_ingredientes (
    receta_id    bigint  not null references public.recetas(id)   on delete cascade,
    alimento_id  bigint  not null references public.alimentos(id) on delete restrict,  -- no se borra un alimento en uso
    cantidad     numeric not null check (cantidad > 0),
    primary key (receta_id, alimento_id)
);
create index if not exists receta_ingredientes_alimento_idx on public.receta_ingredientes (alimento_id);


-- ------------------------------------------------------------
--  Menú semanal y carro de la compra
-- ------------------------------------------------------------

create table if not exists public.menu (
    id          bigint generated always as identity primary key,
    hogar_id    uuid     not null default public.mi_hogar() references public.hogares(id) on delete cascade,
    fecha       date     not null,
    momento_id  smallint not null references public.momentos(id),
    receta_id   bigint   not null references public.recetas(id) on delete cascade,
    raciones    integer  not null check (raciones > 0),
    cocinado    boolean  not null default false
);
create index if not exists menu_hogar_fecha_idx on public.menu (hogar_id, fecha);
create index if not exists menu_receta_idx on public.menu (receta_id);

create table if not exists public.compra_marcados (
    alimento_id  bigint primary key references public.alimentos(id) on delete cascade
);


-- ------------------------------------------------------------
--  Vistas ("security_invoker": respetan las reglas RLS de quien consulta)
-- ------------------------------------------------------------

create or replace view public.v_despensa with (security_invoker = true) as
select a.id,
       a.nombre,
       a.categoria_id,
       coalesce(c.nombre, 'Sin categoría') as categoria,
       a.unidad_id,
       u.abreviatura                       as unidad,
       u.entera,
       u.paso,
       d.cantidad,
       a.stock_minimo,
       d.actualizado,
       (d.cantidad < a.stock_minimo)       as bajo_minimo
from public.alimentos a
join public.despensa  d on d.alimento_id = a.id
join public.unidades  u on u.id = a.unidad_id
left join public.categorias c on c.id = a.categoria_id;

create or replace view public.v_recetas with (security_invoker = true) as
select r.id, r.nombre, r.raciones, count(ri.alimento_id)::integer as ingredientes
from public.recetas r
left join public.receta_ingredientes ri on ri.receta_id = r.id
group by r.id;


-- ------------------------------------------------------------
--  Reglas de seguridad (RLS)
-- ------------------------------------------------------------

alter table public.categorias          enable row level security;
alter table public.unidades            enable row level security;
alter table public.momentos            enable row level security;
alter table public.hogares             enable row level security;
alter table public.miembros            enable row level security;
alter table public.alimentos           enable row level security;
alter table public.despensa            enable row level security;
alter table public.recetas             enable row level security;
alter table public.receta_ingredientes enable row level security;
alter table public.menu                enable row level security;
alter table public.compra_marcados     enable row level security;

-- Catálogos: cualquier usuario con sesión puede leerlos
drop policy if exists "leer catálogo" on public.categorias;
create policy "leer catálogo" on public.categorias for select to authenticated using (true);
drop policy if exists "leer catálogo" on public.unidades;
create policy "leer catálogo" on public.unidades   for select to authenticated using (true);
drop policy if exists "leer catálogo" on public.momentos;
create policy "leer catálogo" on public.momentos   for select to authenticated using (true);

-- Hogar: se ve y se renombra el propio. Crear / unirse / salir, solo con las funciones de abajo.
drop policy if exists "mi hogar" on public.hogares;
create policy "mi hogar" on public.hogares for select to authenticated
    using (id = (select public.mi_hogar()));
drop policy if exists "editar mi hogar" on public.hogares;
create policy "editar mi hogar" on public.hogares for update to authenticated
    using (id = (select public.mi_hogar())) with check (id = (select public.mi_hogar()));

drop policy if exists "miembros de mi hogar" on public.miembros;
create policy "miembros de mi hogar" on public.miembros for select to authenticated
    using (hogar_id = (select public.mi_hogar()));

-- Tablas con hogar_id: todo permitido dentro del propio hogar
drop policy if exists "mi hogar" on public.alimentos;
create policy "mi hogar" on public.alimentos for all to authenticated
    using (hogar_id = (select public.mi_hogar()))
    with check (hogar_id = (select public.mi_hogar()));

drop policy if exists "mi hogar" on public.recetas;
create policy "mi hogar" on public.recetas for all to authenticated
    using (hogar_id = (select public.mi_hogar()))
    with check (hogar_id = (select public.mi_hogar()));

drop policy if exists "mi hogar" on public.menu;
create policy "mi hogar" on public.menu for all to authenticated
    using (hogar_id = (select public.mi_hogar()))
    with check (hogar_id = (select public.mi_hogar())
                and exists (select 1 from public.recetas r where r.id = receta_id));

-- Tablas hijas: se permiten si la fila "padre" es visible (es decir, de mi hogar)
drop policy if exists "mi hogar" on public.despensa;
create policy "mi hogar" on public.despensa for all to authenticated
    using (exists (select 1 from public.alimentos a where a.id = alimento_id))
    with check (exists (select 1 from public.alimentos a where a.id = alimento_id));

drop policy if exists "mi hogar" on public.compra_marcados;
create policy "mi hogar" on public.compra_marcados for all to authenticated
    using (exists (select 1 from public.alimentos a where a.id = alimento_id))
    with check (exists (select 1 from public.alimentos a where a.id = alimento_id));

drop policy if exists "mi hogar" on public.receta_ingredientes;
create policy "mi hogar" on public.receta_ingredientes for all to authenticated
    using (exists (select 1 from public.recetas r where r.id = receta_id))
    with check (exists (select 1 from public.recetas r where r.id = receta_id)
                and exists (select 1 from public.alimentos a where a.id = alimento_id));


-- ------------------------------------------------------------
--  Funciones de hogar (security definer: pueden escribir en miembros)
-- ------------------------------------------------------------

create or replace function public.crear_hogar(p_nombre text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
    v_hogar uuid;
begin
    if auth.uid() is null then raise exception 'Inicia sesión primero'; end if;
    if exists (select 1 from public.miembros where user_id = auth.uid()) then
        raise exception 'Ya perteneces a un hogar';
    end if;
    insert into public.hogares (nombre) values (trim(p_nombre)) returning id into v_hogar;
    insert into public.miembros (user_id, hogar_id, email) values (auth.uid(), v_hogar, auth.jwt() ->> 'email');
    return v_hogar;
end
$$;

create or replace function public.unirse_hogar(p_codigo text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
    v_hogar uuid;
begin
    if auth.uid() is null then raise exception 'Inicia sesión primero'; end if;
    if exists (select 1 from public.miembros where user_id = auth.uid()) then
        raise exception 'Ya perteneces a un hogar';
    end if;
    select id into v_hogar from public.hogares where codigo_invitacion = upper(trim(p_codigo));
    if v_hogar is null then raise exception 'Código de invitación no válido'; end if;
    insert into public.miembros (user_id, hogar_id, email) values (auth.uid(), v_hogar, auth.jwt() ->> 'email');
    return v_hogar;
end
$$;

-- Si sale el último miembro, el hogar se borra con todos sus datos
create or replace function public.salir_hogar()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
    v_hogar uuid;
begin
    delete from public.miembros where user_id = auth.uid() returning hogar_id into v_hogar;
    if v_hogar is not null and not exists (select 1 from public.miembros where hogar_id = v_hogar) then
        -- Primero las recetas (liberan los alimentos que usan) y después el hogar con todo lo demás
        delete from public.recetas where hogar_id = v_hogar;
        delete from public.hogares where id = v_hogar;
    end if;
end
$$;

-- Nuevo código de invitación (el anterior deja de servir)
create or replace function public.regenerar_codigo()
returns text
language sql security invoker set search_path = ''
as $$
    update public.hogares
       set codigo_invitacion = upper(substr(md5(gen_random_uuid()::text), 1, 8))
     where id = public.mi_hogar()
    returning codigo_invitacion
$$;


-- ------------------------------------------------------------
--  Funciones de la app (security invoker: se aplican las reglas RLS)
-- ------------------------------------------------------------

create or replace function public.guardar_alimento(
    p_id bigint, p_nombre text, p_categoria_id smallint, p_unidad_id smallint,
    p_stock_minimo numeric, p_cantidad numeric)
returns bigint
language plpgsql security invoker set search_path = ''
as $$
declare
    v_id bigint := p_id;
begin
    if v_id is null then
        -- El trigger crea su fila en la despensa
        insert into public.alimentos (nombre, categoria_id, unidad_id, stock_minimo)
        values (trim(p_nombre), p_categoria_id, p_unidad_id, p_stock_minimo)
        returning id into v_id;
    else
        update public.alimentos
           set nombre = trim(p_nombre), categoria_id = p_categoria_id,
               unidad_id = p_unidad_id, stock_minimo = p_stock_minimo
         where id = v_id;
        if not found then raise exception 'El alimento ya no existe'; end if;
    end if;
    update public.despensa set cantidad = p_cantidad, actualizado = now() where alimento_id = v_id;
    return v_id;
end
$$;

create or replace function public.ajustar_stock(p_id bigint, p_delta numeric)
returns void
language sql security invoker set search_path = ''
as $$
    update public.despensa
       set cantidad = greatest(0, cantidad + p_delta), actualizado = now()
     where alimento_id = p_id
$$;

-- p_ingredientes: [{"alimento_id": 1, "cantidad": 200}, ...]. Los repetidos se suman.
create or replace function public.guardar_receta(
    p_id bigint, p_nombre text, p_raciones integer, p_instrucciones text, p_ingredientes jsonb)
returns bigint
language plpgsql security invoker set search_path = ''
as $$
declare
    v_id bigint := p_id;
begin
    if v_id is null then
        insert into public.recetas (nombre, raciones, instrucciones)
        values (trim(p_nombre), p_raciones, p_instrucciones)
        returning id into v_id;
    else
        update public.recetas
           set nombre = trim(p_nombre), raciones = p_raciones, instrucciones = p_instrucciones
         where id = v_id;
        if not found then raise exception 'La receta ya no existe'; end if;
    end if;

    delete from public.receta_ingredientes where receta_id = v_id;
    insert into public.receta_ingredientes (receta_id, alimento_id, cantidad)
    select v_id, (i ->> 'alimento_id')::bigint, sum((i ->> 'cantidad')::numeric)
      from jsonb_array_elements(coalesce(p_ingredientes, '[]'::jsonb)) as i
     group by (i ->> 'alimento_id')::bigint;
    return v_id;
end
$$;

-- Cocinar descuenta de la despensa los ingredientes (escalados a las raciones). Deshacer los devuelve.
create or replace function public.marcar_cocinado(p_id bigint, p_cocinado boolean)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
    v_actual boolean;
begin
    select cocinado into v_actual from public.menu where id = p_id for update;
    if not found then raise exception 'El plato ya no está en el menú'; end if;
    if v_actual = p_cocinado then return; end if;

    update public.despensa d
       set cantidad = greatest(0, d.cantidad
                        + (case when p_cocinado then -1 else 1 end) * ri.cantidad * m.raciones / r.raciones::numeric),
           actualizado = now()
      from public.menu m
      join public.recetas r              on r.id = m.receta_id
      join public.receta_ingredientes ri on ri.receta_id = r.id
     where m.id = p_id and d.alimento_id = ri.alimento_id;

    update public.menu set cocinado = p_cocinado where id = p_id;
end
$$;

-- Lista de la compra:
--   necesario = ingredientes de los platos NO cocinados entre dos fechas
--   a_comprar = necesario + stock_minimo − despensa   (solo si es > 0)
--   cantidad  = a_comprar redondeado (hacia arriba si la unidad es entera)
create or replace function public.lista_compra(p_desde date, p_hasta date)
returns table (
    id bigint, nombre text, categoria text, unidad text, entera boolean,
    necesario numeric, en_despensa numeric, stock_minimo numeric,
    a_comprar numeric, cantidad numeric, marcado boolean)
language sql stable security invoker set search_path = ''
as $$
    with necesidades as (
        select ri.alimento_id,
               sum(ri.cantidad * m.raciones / r.raciones::numeric) as necesario
          from public.menu m
          join public.recetas r              on r.id = m.receta_id
          join public.receta_ingredientes ri on ri.receta_id = r.id
         where not m.cocinado
           and m.fecha between p_desde and p_hasta
         group by ri.alimento_id
    ),
    calculo as (
        select v.id, v.nombre, v.categoria, v.unidad, v.entera,
               coalesce(n.necesario, 0)                                as necesario,
               v.cantidad                                              as en_despensa,
               v.stock_minimo,
               coalesce(n.necesario, 0) + v.stock_minimo - v.cantidad  as a_comprar
          from public.v_despensa v
          left join necesidades n on n.alimento_id = v.id
    )
    select c.*,
           case when c.entera then ceil(c.a_comprar - 0.000001) else round(c.a_comprar, 2) end,
           exists (select 1 from public.compra_marcados cm where cm.alimento_id = c.id)
      from calculo c
     where c.a_comprar > 0.0001
     order by c.categoria, lower(c.nombre)
$$;

-- Suma a la despensa lo marcado en el carro y lo vacía. Devuelve cuántos alimentos se añadieron.
create or replace function public.registrar_compra(p_desde date, p_hasta date)
returns integer
language plpgsql security invoker set search_path = ''
as $$
declare
    v_n integer;
begin
    update public.despensa d
       set cantidad = d.cantidad + l.cantidad, actualizado = now()
      from public.lista_compra(p_desde, p_hasta) l
     where l.marcado and d.alimento_id = l.id;
    get diagnostics v_n = row_count;
    delete from public.compra_marcados where true;   -- RLS limita el borrado a mi hogar
    return v_n;
end
$$;


-- ------------------------------------------------------------
--  Copias de seguridad en JSON (mismo formato para exportar e importar)
-- ------------------------------------------------------------

create or replace function public.exportar_datos()
returns jsonb
language sql stable security invoker set search_path = ''
as $$
    select jsonb_build_object(
        'formato', 'menu-semanal', 'version', 1, 'exportado', now(),
        'alimentos', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', v.id, 'nombre', v.nombre, 'categoria', v.categoria, 'unidad', v.unidad,
                       'cantidad', v.cantidad, 'stock_minimo', v.stock_minimo) order by v.id)
              from public.v_despensa v), '[]'::jsonb),
        'recetas', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', r.id, 'nombre', r.nombre, 'raciones', r.raciones, 'instrucciones', r.instrucciones,
                       'ingredientes', coalesce((
                           select jsonb_agg(jsonb_build_object('alimento_id', ri.alimento_id, 'cantidad', ri.cantidad))
                             from public.receta_ingredientes ri where ri.receta_id = r.id), '[]'::jsonb))
                       order by r.id)
              from public.recetas r), '[]'::jsonb),
        'menu', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'fecha', m.fecha, 'momento', mo.nombre, 'receta_id', m.receta_id,
                       'raciones', m.raciones, 'cocinado', m.cocinado) order by m.fecha, m.id)
              from public.menu m join public.momentos mo on mo.id = m.momento_id), '[]'::jsonb)
    )
$$;

-- Importa una copia (o los datos de la versión anterior de la app).
-- Los alimentos y recetas que ya existen (mismo nombre) no se duplican.
create or replace function public.importar_datos(p_datos jsonb)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
    a jsonb; r jsonb; m jsonb;
    v_id bigint;
    v_alimentos jsonb := '{}';     -- id antiguo → id nuevo
    v_recetas   jsonb := '{}';     -- solo las recetas creadas ahora
    n_alimentos integer := 0; n_recetas integer := 0; n_menu integer := 0;
begin
    if public.mi_hogar() is null then raise exception 'Primero crea un hogar o únete a uno'; end if;

    for a in select * from jsonb_array_elements(coalesce(p_datos -> 'alimentos', '[]')) loop
        select al.id into v_id from public.alimentos al
         where al.hogar_id = public.mi_hogar() and lower(al.nombre) = lower(trim(a ->> 'nombre'));
        if v_id is null then
            insert into public.alimentos (nombre, categoria_id, unidad_id, stock_minimo)
            values (trim(a ->> 'nombre'),
                    (select c.id from public.categorias c where c.nombre = a ->> 'categoria'),
                    coalesce((select u.id from public.unidades u where u.abreviatura = a ->> 'unidad'),
                             (select u.id from public.unidades u where u.abreviatura = 'ud')),
                    coalesce((a ->> 'stock_minimo')::numeric, 0))
            returning id into v_id;
            update public.despensa set cantidad = coalesce((a ->> 'cantidad')::numeric, 0) where alimento_id = v_id;
            n_alimentos := n_alimentos + 1;
        end if;
        v_alimentos := v_alimentos || jsonb_build_object(a ->> 'id', v_id);
    end loop;

    for r in select * from jsonb_array_elements(coalesce(p_datos -> 'recetas', '[]')) loop
        continue when exists (select 1 from public.recetas re
                               where re.hogar_id = public.mi_hogar() and lower(re.nombre) = lower(trim(r ->> 'nombre')));
        insert into public.recetas (nombre, raciones, instrucciones)
        values (trim(r ->> 'nombre'), coalesce((r ->> 'raciones')::integer, 2), r ->> 'instrucciones')
        returning id into v_id;
        insert into public.receta_ingredientes (receta_id, alimento_id, cantidad)
        select v_id, (v_alimentos ->> (i ->> 'alimento_id'))::bigint, sum((i ->> 'cantidad')::numeric)
          from jsonb_array_elements(coalesce(r -> 'ingredientes', '[]')) as i
         where v_alimentos ? (i ->> 'alimento_id')
         group by 2;
        v_recetas := v_recetas || jsonb_build_object(r ->> 'id', v_id);
        n_recetas := n_recetas + 1;
    end loop;

    -- Solo se importan los platos de recetas nuevas, para no duplicar menús al importar dos veces
    for m in select * from jsonb_array_elements(coalesce(p_datos -> 'menu', '[]')) loop
        continue when not v_recetas ? (m ->> 'receta_id');
        insert into public.menu (fecha, momento_id, receta_id, raciones, cocinado)
        select (m ->> 'fecha')::date, mo.id, (v_recetas ->> (m ->> 'receta_id'))::bigint,
               coalesce((m ->> 'raciones')::integer, 2), coalesce((m ->> 'cocinado')::boolean, false)
          from public.momentos mo where mo.nombre = m ->> 'momento';
        n_menu := n_menu + 1;
    end loop;

    return jsonb_build_object('alimentos', n_alimentos, 'recetas', n_recetas, 'menu', n_menu);
end
$$;


-- ------------------------------------------------------------
--  Permisos: nada para usuarios sin sesión (anon)
-- ------------------------------------------------------------

revoke all on public.categorias, public.unidades, public.momentos, public.hogares, public.miembros,
              public.alimentos, public.despensa, public.recetas, public.receta_ingredientes,
              public.menu, public.compra_marcados, public.v_despensa, public.v_recetas
    from anon;

grant select on public.categorias, public.unidades, public.momentos, public.v_despensa, public.v_recetas
    to authenticated;
grant select, update on public.hogares to authenticated;
grant select on public.miembros to authenticated;
grant select, insert, update, delete on public.alimentos, public.despensa, public.recetas,
                                        public.receta_ingredientes, public.menu, public.compra_marcados
    to authenticated;

do $$
declare
    f record;
begin
    for f in
        select p.oid::regprocedure as firma
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('mi_hogar', 'crear_fila_despensa', 'crear_hogar', 'unirse_hogar', 'salir_hogar',
                             'regenerar_codigo', 'guardar_alimento', 'ajustar_stock', 'guardar_receta',
                             'marcar_cocinado', 'lista_compra', 'registrar_compra', 'exportar_datos', 'importar_datos')
    loop
        execute format('revoke all on function %s from public, anon', f.firma);
        execute format('grant execute on function %s to authenticated', f.firma);
    end loop;
end
$$;


-- ------------------------------------------------------------
--  Tiempo real: avisar a la app cuando cambian estas tablas
-- ------------------------------------------------------------

do $$
declare
    t text;
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        foreach t in array array['hogares', 'miembros', 'alimentos', 'despensa', 'recetas',
                                 'receta_ingredientes', 'menu', 'compra_marcados'] loop
            if not exists (select 1 from pg_publication_tables
                            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
                execute format('alter publication supabase_realtime add table public.%I', t);
            end if;
        end loop;
    end if;
end
$$;
