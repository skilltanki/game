# src/engine — копия движка

Копия модулей `packages/game/src` (95 файлов, снимок коммита `970fa23`, 2026-10-14),
до которых дотягивался мобильный клиент. Правило `CLAUDE.md` п. 10: пакеты не
импортируют друг друга, поэтому движок живёт здесь как своя копия и сопровождается
независимо от десктопного клиента. Относительные импорты внутри копии — как в
оригинале; `apps/mobile/src/**` импортирует её относительными путями (без alias).

Отличия от `packages/game/src` (швы под мобильный клиент, в десктопе их нет):

- `tank/TankAssets.ts` — `setAssetUrlResolver(fn)`: `assetUrl()` сначала спрашивает
  резолвер (бандл или облако per-file). Ставится до импорта движка (`src/main.ts`).
- `map/MapLoader.ts` — пропы и `library.xml` резолвятся через `assetUrl()` по файлу,
  `assetsBase` опционален.
- `map/CoplanarOverlaps.ts` + `map/MapLoader.ts` + `map/SkyBox.ts` — перенесено из десктопа 2026-10-15
  (скопировано как есть): дедупликация одинаковых `<prop>`, разрешение z-fighting копланарных пропов
  полигон-офсетом (клон материала с `depthBias`), плоский туман неба запекается в текстуру граней
  (`tex·(1−α) + fog·α`; раньше цвет шёл в `emissive`, а StandardMaterial УМНОЖАЕТ карту на него —
  для highways это 0.967, небо оставалось без дымки). Считать копию независимой, как и весь `src/engine`.
- `map/MapLoader.ts` — `get textureUrls()`, `map/SkyBox.ts` — `readonly textureUrls`: списки URL текстур
  сцены, чтобы хост выгружал их из реестра ассетов вместе со сценой (`TextureBudgetService`).
- `tank/Tank.ts` + `logic/statusEffects.ts` + `game/Supplies.ts` — `Tank.speedBoost/accelerationBoost`: множители нитро;
  проход статусов (струя ×0,7, заморозка ×0,45) умножает свой фактор на них, а не возвращает голую скорость
  корпуса — раньше конец струи Изиды/Огнемёта/Фриза отменял нитро.
- `game/Supplies.ts` — `cancel(type)`: ремкомплект прерывается попаданием; нитро поднимает
  потолок скорости сразу (`setMaxSpeed(…, true)`): сглаживание 100 ед/с² при тяге, пропорциональной
  запасу под текущим потолком, давало эффект только после отпускания газа; `clearEffects()`
  (респаун) снимает нитро тоже сразу (`endEffect(type, immediate)`).
- `game/LoadPool.ts` (2026-10-31, в обеих копиях) — пул на 5 одновременных загрузок: `loadPool.run()` для
  ручных `trackedFetch` и `installLoadPool(app)` — monkey patch `app.assets.load` для текстур/звуков самого
  PlayCanvas (версия 2.23.1 зафиксирована). `game/AssetProgress.ts` — `normalise()` срезает корень ассетов
  (`/assets/`), чтобы ключи совпадали с манифестом. Хост подключает оба в `EngineService.create`; десктоп
  (`packages/game/src/main.ts`) пул не подключает.
- `game/LoadRetry.ts` (2026-10-31, в обеих копиях) — до 5 попыток на загрузку: `installLoadRetry(app)` =
  `app.loader.enableRetry(4)` (встроенные ретраи PlayCanvas для текстур/звуков), `withRetry` для
  `trackedFetch` (4xx кроме 408/429 — одна повторная попытка, затем окончательно). Десктоп `withRetry` получает через `AssetProgress`,
  `installLoadRetry` в `main.ts` не подключён.
- `weapon/ModPhysics.ts` (2026-11-05, GENERATED в `skilltanki` скриптом `packages/game/scripts/export-mod-physics.mjs`
  из garage-данных оригинального сервера; сюда — копией, не генерацией): физика корпусов и башен по модификациям,
  `BASE_IMPACT_FORCE`. Её читают `tank/HullSpecs.ts` (`getHullSpec`), `weapon/WeaponSpecs.ts` (силы) и `game/GameTank.ts`
  (башня). Обновлять — перегенерировать в `skilltanki` и скопировать файл.
- `weapon/WeaponSpecs.ts` — `resolveWeaponSpec(turret, mod)` (2026-11-05, из `skilltanki`, обе копии байт в байт):
  спека оружия с цифрами модификации — урон/лечение стрима, Shaft, перезарядка, силы, `modBalance`; `GameTank`
  строит оружие из неё и берёт скорость башни из таблицы (`turretTurnScale` для ботов). Оружия сами про M не знают.

Не скопировано (заменено сервисами `lib/tanki`): `main.ts`, `logic/startBattle.ts`,
`logic/battleLoop.ts`, `game/Menu.ts`, `game/Hud.ts`, `game/BotController.ts`,
`game/BattleDirectory.ts`, `game/ScreenshotMode.ts`, `net/*`, `editor/*`.
