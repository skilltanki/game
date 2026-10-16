# План: домен `apps/mobile/src/lib/engine` — умные боты с навигацией

## Context

Боты в `lib/tanki` ездят по прямой: на Island за 40 с — 12 утоплений, 0 событий
флага (`PLAN.md`, «Известные проблемы»). Зонды земли (`avoidDrops`) снижают
частоту, но без карты проходимости боты не могут ни дойти до флага, ни донести
его, ни помочь носителю. Нужен отдельный домен **`lib/engine`** — второй di-kit
модуль с: (1) «рефлексией карты» — многоуровневой сеткой проходимости из
`collision-geometry`, (2) поиском кратчайшего пути с учётом уровней, рамп,
обрывов и угроз, (3) тактикой (угрозы, укрытия, чокпоинты, память о враге)
и (4) командной координацией (роли, эскорт носителя, перехват, оборона),
(5) личностями ботов и utility-планировщиком, чтобы с ними было интересно.

`lib/tanki` остаётся оркестратором боя и потребляет `engine.botEngineService`
вместо `BotBrainService`. Правила `CLAUDE.md`: SOLID, di-kit, стрелочные
методы, **без импортов движка (`src/engine/*`) в `lib/engine`** — он не трогает
движок напрямую, а получает мир через интерфейсы из `src/model/engine/*`,
которые реализует адаптер в `lib/tanki` (у него импорты движка уже есть).

## Установленные факты (из отчётов)

**Формат карт** (`packages/game/src/map/CollisionGeometryParser.ts`, XML в
`packages/game/public/maps/summer/*.xml`):
- Три типа фигур: `collision-plane` (width/length + position/rotation →
  `CollisionRect`, нормаль = локальный +Z), `collision-box` (size → `CollisionBox`,
  повороты только вокруг Z), `collision-triangle` (v0..v2 в локальной XY-плоскости).
  Поворот R = Rz·Ry·Rx (`Matrix3.setRotationMatrix`). Всего по 53 картам 100 965 фигур;
  самые тяжёлые: babylon 7518, lost_temple 5006, deathtrack 4535.
- **Лестниц нет.** Рампы — одиночные большие наклонные плоскости 16–37°
  (kolhoz 27°, fort_knox_i 37°, madness 31°). Мелкие наклонные плоскости 11°/16°/47°/58°
  длиной 100 — это профили краёв террас вместе с сегментами 69–80°: **обрывы, не рампы**.
- Уровни: Island один этаж (−8700) + крыши; kolhoz 6; deathtrack ~8 (−600…2900);
  madness ~20 площадок с шагом 300 и гравитация 500.
- **Вода без коллизии**, у границ карт стен нет (край Island — открытое плато с юбкой
  вниз). `killZ` = min aabb.z − 1000 (Island −10 300).
- Танк: корпуса 264–370 × 462–644 × 125–198; подвеска 5 лучей на гусеницу, макс. луч 50,
  номинал 25; луч не считается при `normal.z ≤ cos 60°`; тяга гаснет с 45° до 60°;
  < 45° — проходимо, 45–60° — предел, > 60° — стена. Препятствия < 15 проходят под
  днищем; высота «ступени», которую берут скосы (fenders), не задана в коде —
  **измерить эмпирически**.
- API (`packages/game/src/tank/TanksCollisionDetector.ts`): `raycastStatic` (только
  ближайшее, t>0), `hasStaticHit`, `testStaticCollision(box)` (бокс должен иметь
  `calculateAABB()`, группу ∩255, не статик-тело), `getShapeContactsWithStatic`;
  AABB-запроса нет, но `CollisionKdTree.staticBoundBoxes` публичен. `RayHit`:
  shape, position, normal (к лучу), t.

**Текущий бот-слой** (`apps/mobile/src/lib/tanki/services/bot/*`): бот — `ControlSource`
(`start/tick/stop`), думает в `tick()` (33 мс), пушит `TankCommand`;
`BotPerception` — живые замыкания (танки, LOS, флаги, `groundHeightAt`); навигация —
курс по прямой + зонды; стратегии по режимам отдают `hunt|goto|hold|roam`; память
на бота — `BotMemory`. Хук сборки карты — `BattleSessionService.start` сразу после
`mapStageService.load` (`MapStage.staticShapes`, `spawnPoints`, `ctfFlagPositions`,
`killZ`). di-kit: два `createActivator` независимы, кросс-инжекта нет — `lib/tanki`
импортирует агрегат `engine` из `lib/engine/index.ts`; `lib/engine` не импортирует
`lib/tanki` (иначе цикл).

## Архитектура

### Поток

```
MapStage ──► NavWorldAdapter (tanki) ──► engine.navGridBuildService.build()  ──► NavGrid
                                                     │  (чанками во время загрузки, кэш IndexedDB)
                                                     ▼
                  NavGraph (рёбра, клиренс, стоимость) ─► DistanceFields (от баз/спавнов)
                                                     │
                       MapInsight (укрытия, чокпоинты, маршруты флага)
                                                     │
 per tick ──► BattleViewAdapter (tanki) ──► Sighting/Threat ──► Blackboard(team) ──► RoleAuction
                                                     │
                                UtilityPlanner(persona) ─► Action ─► Path request ─► PathFollow ─► TankCommand
```

### Папки и файлы (`apps/mobile/src`)

```
model/engine/
  World.ts        StaticWorld { bounds, killZ, raycastDown(x,y,fromZ,depth): GroundHit|null,
                                headroom(x,y,z,height): boolean, probeBox(x,y,z,half): boolean,
                                lineOfSight(a,b): boolean }   — реализует адаптер в lib/tanki
                  BattleView { now, mode, flagRules, actors(): ActorView[], flags(), me(id) }
                  ActorView = TankView + { control: 'touch'|'bot'|'remote' }
  Nav.ts          NavCell {col, level}, NavLevel {z, normalZ, clearance, flags}, NavGrid (shape,
                  typed arrays), EdgeRule {maxStep, maxSlopeTan, maxDrop}, NavQuery, CostLayer
  Path.ts         PathRequest {from, to, costLayers[], maxCost}, Path {points[], cells[], cost},
                  PathStatus 'ok'|'partial'|'unreachable'
  Insight.ts      CoverSpot, Chokepoint, FlagRoute {cells, length, exposure}, DistanceField
  Tactics.ts      Sighting {actorId, pos, at, confidence}, ThreatSample, ThreatQuery
  Squad.ts        SquadRole 'carrier'|'escortFront'|'escortRear'|'medic'|'interceptor'|'defender'|'hunter'|'ambusher',
                  Assignment, Blackboard snapshot types
  Persona.ts      BotPersona {aggression, caution, accuracy, patience, teamwork}, Difficulty→Persona range
  Action.ts       ActionKind (capture, carryHome, escort, intercept, defend, hunt, retreat, heal,
                  patrol, ambush, pickSupply), ActionScore, ActionContext
  Bench.ts        BenchConfig/BenchReport (метрики прогона)
  index.ts

classes/engine/
  NavGrid.ts       контейнер сетки: columns×levels в Int32/Float32Array, индекс col→levels,
                   accessors cellAt(x,y,z), neighbours(cell), serialize/deserialize (кэш)
  BinaryHeap.ts    очередь для A*/Dijkstra
  PathFollower.ts  состояние следования одного бота: путь, индекс, lookahead, reverse-режим
  Blackboard.ts    общая память команды: роли, цели, замеченные враги, маршрут носителя
  SightingMemory.ts последняя известная позиция врага с затуханием (бот не видит сквозь стены)
  BotPersona.ts    генерация/валидация персоны из сложности + seed
  Rng.ts           mulberry32 (детерминированные бенчи)
  index.ts

lib/engine/
  core/di.ts          createActivator('skilltanki-engine')
  core/types.ts       nav / insight / motion / tactics / squad / brain / public
  core/provide.ts
  index.ts            агрегат `engine` + init(); globalThis.engine
  services/nav/
    NavGridBuildService.ts   выборка колонок: для каждой (x,y) лучи вниз с zTop повторно
                             (ниже предыдущего попадания) → список этажей; этаж валиден, если
                             normal.z ≥ cos45° (ровно/рампа), иначе 'steep' (стена/обрыв);
                             headroom вверх ≥ TANK_HEIGHT (220) иначе 'low'; probeBox на узких
                             местах (ширина < 2 клеток) — всё чанками по времени (≤ 8 мс/кадр)
    NavGraphService.ts       рёбра 8-соседей между этажами: |Δz| ≤ STEP (40) или уклон ≤ tan45
                             по расстоянию; односторонние «спрыгнуть» при Δz↓ ≤ DROP (250);
                             клиренс = BFS-расстояние до стены/пустоты в клетках; стоимость =
                             1 + штраф за уклон + за клиренс < 2 клеток + за односторонность
    PathfindingService.ts    A* (октильная эвристика + |Δz|), слои стоимости (угрозы, занятость),
                             лимит узлов, partial path к ближайшей достижимой клетке,
                             кэш (from,to,слой) с TTL
    PathSmoothingService.ts  string pulling: срезаем вершины при LOS по земле + клиренс коридора
    DistanceFieldService.ts  Dijkstra от баз/флагов/спавнов → Float32Array расстояний
                             (мгновенное «кто ближе по пути», эвристика для перехвата)
    NavQueryService.ts       nearestWalkable(pos), randomReachable(around, r), isReachable(a,b),
                             cellOf(pos), isOverVoid(pos)
    NavCacheService.ts       IndexedDB: ключ (mapId, версия сетки, hash assets.json) → NavGrid
  services/insight/
    ExposureService.ts       на клетку: доля открытых лучей из 8 направлений на высоте башни
                             → укрытия (низкая экспозиция) и «обзорные точки» (высокая + высота)
    ChokepointService.ts     K случайных кратчайших путей между кластерами спавнов → счётчик
                             использования клеток → чокпоинты (узко + часто)
    RouteService.ts          маршруты флага: база↔база, k-альтернативы (штраф за пересечение
                             с найденными), длина/экспозиция; для засад и перехвата
    MapInsightService.ts     собирает всё, кэширует вместе с сеткой
  services/motion/
    PathFollowService.ts     pure pursuit: точка на пути на lookahead (300–500 по скорости),
                             скорость по кривизне и уклону, реверс если цель сзади и близко,
                             триггеры перепланирования (уход > 300, цель сместилась > 500,
                             таймер 1 с, блокировка), финальный подход к точке
    LocalAvoidanceService.ts обход танков: боковое смещение от союзника/врага на пути,
                             очередь на узких местах (клиренс < 2)
    StuckRecoveryService.ts  застревание: реверс по безопасной клетке позади (из сетки),
                             поворот на месте, перепланирование с «занятыми» клетками
  services/tactics/
    SightingService.ts       что бот реально видит (LOS от башни); память позиций с затуханием;
                             обмен в Blackboard (союзники сообщают)
    ThreatMapService.ts      динамический слой стоимости (клетка 400): присутствие врагов
                             (затухание), недавние смерти, экспозиция к известным врагам
    TargetSelectService.ts   выбор цели: угроза носителю > ближайший видимый > слабый > ...
    GunnerService.ts         перенос BotGunnerService (ошибка прицела, лаг, реакция; профили)
    SupplyService.ts         перенос BotSupplyService + «ядерка при штурме», «нитро носителю»
  services/squad/
    BlackboardService.ts     одна доска на команду; снимок на тик; события (носитель под огнём)
    RoleAuctionService.ts    раз в 1 с: стоимость роли для каждого бота (путь-дистанция из
                             DistanceField, здоровье, оружие, персона) → назначение (венгерка
                             не нужна: жадно по приоритету carrier → escorts → interceptor →
                             defenders → hunters)
    EscortService.ts         позиции эскорта на пути носителя: front (+600 по пути),
                             rear (−500, между носителем и главной угрозой), medic (Isida:
                             в зоне лечения, огонь по союзнику = лечение); body-block при LOS врага
    InterceptService.ts      предсказание маршрута чужого носителя (наш A* от него к его цели),
                             точка перехвата = первая клетка, где наш путь короче его
    DefenceService.ts        посты у базы: укрытия с обзором на подходы (из Insight), ротация
  services/brain/
    PersonaService.ts        персона на бота (сложность + seed), влияет на веса/реакцию
    UtilityPlannerService.ts раз в 250 мс: score каждого доступного действия (режим задаёт
                             доступность) = базовый × персона × ситуация + бонус текущему
                             (гистерезис); выбранное действие исполняется до смены
    actions/                 один исполнитель на действие (Capture, CarryHome, Escort, Intercept,
                             Defend, Hunt, Retreat, Heal, Patrol, Ambush, PickSupply):
                             объективная точка/цель → PathFollow/Gunner → TankCommand
    BotEngineService.ts      createSource(actor, difficulty, seed): ControlSource (start/tick/stop),
                             композиция сервисов, runtime на бота; prepareBattle(world, view),
                             disposeBattle()
  services/public/
    NavDebugService.ts       дев-оверлей: колбэки «нарисуй сетку/путь/роли» (реализует tanki
                             через pc-линии), включается ?debug=nav
    BenchService.ts          прогон без игрока: все слоты — боты; сбор BenchReport

lib/tanki (изменения)
  services/bot/*             удалить (перенос в engine); BotMemory/strategies — удалить
  services/battle/NavWorldAdapterService.ts   StaticWorld поверх TankPhysicsScene/MapStage
  services/battle/BattleViewAdapterService.ts BattleView поверх BattleState/FlagMode/ModeRule
  services/battle/BattleSessionService.ts     после load: фаза «Navigation» → engine.prepareBattle;
                                              dispose → engine.disposeBattle
  services/battle/TankSpawnService.ts         controlFor('bot') → engine.botEngineService.createSource
  services/ui/NavOverlayService.ts            рисование сетки/путей (dev)
  core/types|provide|index                    регистрация адаптеров/оверлея

scripts/bench.mjs            Playwright: поднимает dev-сервер, открывает
                             /?bench=ctf&map=island_old_summer&bots=6&seconds=180&seed=1,
                             ждёт window.__bench, печатает/сохраняет JSON (drownings, kills by
                             cause, flag events, captures per team, stuck events, path failures,
                             avg tick ms)
src/bench/BenchMode.ts       страница-режим: читает query, стартует бой с ботом вместо игрока
```

### Ключевые алгоритмы

**Сетка.** Клетка 100 ед. (1 м); карта до 300×330 колонок (deathtrack ~80 k колонок,
madness ~20 этажей на часть колонок). Этаж колонки: повторные `raycastDown` с
`maxZ + 500`, следующий старт на 5 ниже попадания; принимаем `normal.z ≥ cos 45°`
как walkable, `cos 60°…cos 45°` как marginal (стоимость ×3), меньше — стена.
Headroom: луч вверх от z+10 на 220. Пустота (нет попадания до `killZ`) = void.
Клиренс BFS от void/стен; проходимо, если клиренс ≥ 2 (≈ полуширина корпуса 165).
Оценка: ~3–4 луча на колонку → 250–400 k лучей ≈ 1–3 с на телефоне; строим чанками
по 8 мс в кадре на экране загрузки (фаза «Navigation»), результат в IndexedDB
(ключ mapId + версия алгоритма + размер XML). Island (141 фигура) — < 100 мс.

**Рёбра.** Между соседними колонками (8 направлений) этаж↔этаж: |Δz| ≤ 40 или
Δz/дистанция ≤ tan 45° (рампы 37° проходят; профили 58°+ дают Δz > 160 на клетку —
режутся); спуск Δz 40…250 — одностороннее ребро с штрафом (прыжок вниз допустим,
назад нельзя). Калибровка STEP/DROP — в M1 эмпирическим тестом (бенч ставит танк
перед ступенями 20/40/60/80 и мерит).

**Путь.** A* с эвристикой octile + |Δz|·0.5, стоимость = ребро × (1 + слои:
угроза, занятость клеток союзниками, персональный штраф экспозиции для носителя).
Лимит 20 k узлов; при неудаче — partial path к клетке с минимальной эвристикой
(бот «идёт в сторону цели»). Кэш путей 1 с. Сглаживание string-pulling по LOS на
уровне земли + проверка клиренса коридора.

**Следование.** Pure pursuit: цель на пути на lookahead = clamp(300 + speed·0.4, 300, 700);
turn = пропорционально ошибке курса, move по кривизне (резкий поворот → 0.5) и
уклону вниз у обрыва (< 1 клетка клиренса → 0.5); реверс, если точка сзади (>120°)
и ближе 400; при финальном подходе — остановка в arriveRadius. Защита от
обрывов остаётся как последний рубеж (`avoidDrops` переезжает в `StuckRecovery`/follow).

**Память и честность.** Бот видит врага только при LOS от башни (`SightingService`);
союзники делятся замеченным через Blackboard (как рация); позиция «стареет»
(confidence падает за 6 с) — бот идёт туда, где враг был, а не туда, где он есть.
Это и честнее, и интереснее: от бота можно оторваться.

**Угрозы.** `ThreatMapService`: клетки 400 ед., присутствие известных врагов с
затуханием 10 с, смерти союзников 20 с, экспозиция к известным позициям;
носитель и медик планируют путь с весом угроз ×3, охотники ×1, перехватчик ×0.5.

**Роли (CTF/Assault).** Раз в 1 с `RoleAuctionService`: carrier = у кого флаг; escortFront/
escortRear — два ближайших по path-дистанции (не медик) при `teamwork` персоны;
medic — Isida, если есть; interceptor — если враг несёт наш флаг: тот, чей
предсказанный путь к точке перехвата короче пути врага; defender — 1 на 3 ботов
(посты из Insight: укрытия с обзором на 2 главных маршрута флага); остальные hunter;
ambusher — один «терпеливый» бот ждёт в укрытии у чокпоинта на маршруте врага.
TDM: hunters + 1 support (идёт к раненому союзнику, добивает его цель); DM: hunters с
персональной осторожностью (retreat/heal при HP < caution·50 %).

**Эскорт носителя.** EscortService строит путь носителя (или берёт из его runtime) и
держит front-эскорт на +600 по пути (зачищает), rear-эскорт между носителем и
самой сильной известной угрозой (−500), медика в 1200 позади с лучом на носителя;
при LOS врага на носителя ближайший эскорт встаёт на отрезок «враг–носитель»
(body-block) и ведёт огонь по врагу. Носитель получает нитро от SupplyService, при
HP < 40 % и живом медике — ждёт в укрытии 2 с.

**Персоны.** Из сложности: easy — реакция 550 мс, разброс 1.6, teamwork 0.3,
caution 0.8; normal — 300/1.15/0.6/0.5; hard — 160/0.75/0.9/0.3; плюс ±20 % шум по seed
и «характер» (sniper предпочитает обзорные точки и Railgun/Shaft; rusher — ближний
бой и нитро). Персона отображается в имени-подписи? Нет — только в поведении.

**Utility-планировщик.** Действия и базовые очки (режимная доступность): carryHome 100
(есть флаг), intercept 90 (враг несёт наш флаг, я назначен), escort 70 (назначен),
capture 60 (attacker), defend 50 (назначен), hunt 40 + видимость цели, retreat 0→80 при
HP < порог и враги > 1, heal 30 при аптечке готовой и HP < 60 %, ambush 45 (persona
patience > 0.6, чокпоинт свободен), patrol 10. Выбранное действие держится минимум
2 с (гистерезис +15), чтобы боты не дёргались.

### Интеграция с `lib/tanki`

- `BattleSessionService.start`: после `mapStageService.load` → `loadingScreen.setPhase('Navigation')`
  → `await engine.botEngineService.prepareBattle(navWorldAdapter, battleViewAdapter, {mapId, mode, seed})`.
- `TankSpawnService.controlFor('bot')` → `engine.botEngineService.createSource(actor, difficulty, seed)`.
- `dispose` → `engine.botEngineService.disposeBattle()`.
- `BattleEventService` остаётся источником событий для бенча (death/flag).
- Правило CLAUDE.md п. 10/11: `lib/engine` не импортирует ни `src/engine/*`, ни `lib/tanki`;
  весь доступ к физике — через `StaticWorld`/`BattleView` (адаптеры в `lib/tanki`). Это же делает `lib/engine` готовым к
  Web Worker (адаптер → прокси через postMessage) и к серверу.

### Производительность (бюджет)

| Что | Бюджет |
| --- | --- |
| Сборка сетки Island / deathtrack / babylon | < 0.1 с / < 3 с / < 5 с (чанками, с кэшем — 0) |
| A* на запрос | ≤ 2 мс (лимит узлов), ≤ 1 запрос/бот/с + события |
| Тик бота (7 ботов) | ≤ 0.3 мс средний на бота, без аллокаций в горячем пути |
| Память сетки | ≤ 8 МБ для самых больших карт (typed arrays) |

## Этапы и критерии приёмки

**M1 — Сетка + путь + следование (Island, DM/CTF).**
Файлы: `model/engine/{World,Nav,Path}.ts`, `classes/engine/{NavGrid,BinaryHeap,PathFollower}.ts`,
`lib/engine/{core/*,index.ts}`, `services/nav/{NavGridBuild,NavGraph,Pathfinding,PathSmoothing,NavQuery,NavCache}`,
`services/motion/{PathFollow,StuckRecovery}`, `services/brain/BotEngineService` (пока со
старой логикой целей: hunt/goto по пути), адаптеры и правки в `lib/tanki`, `NavOverlay` (dev),
`scripts/bench.mjs` + `src/bench/BenchMode.ts`.
Критерии: бенч CTF Island 6 ботов 3 мин — **0 утоплений**, ≥ 4 захвата флага суммарно,
stuck > 10 с — 0; сетка Island < 100 мс; старые `services/bot/*` удалены.

**M2 — Многоуровневые карты.** Калибровка STEP/DROP (бенч «ступени»), headroom, kolhoz /
deathtrack / madness (гравитация 500): isReachable между всеми парами спавнов ≥ 95 %,
0 утоплений, кэш IndexedDB, сборка в бюджете.

**M3 — Тактика и команда.** Sighting/Threat/Blackboard/RoleAuction/Escort/Intercept/Defence,
TargetSelect, перенос Gunner/Supply. Критерии: в CTF 3v3 (боты vs боты) эскорт стоит в
±600 от носителя ≥ 70 % времени переноса; перехват успешен ≥ 50 %; медик лечит носителя.

**M4 — Персоны и utility.** PersonaService, UtilityPlanner, actions/*, Insight
(укрытия/чокпоинты/маршруты), ambush. Критерии: K/D игрока против easy/normal/hard
в бенче с «сценарным игроком»… (вручную) — субъективно интересно: боты отступают,
лечатся, засадят, не повторяют один маршрут.

## Verification

1. `npm run typecheck -w skilltanki-mobile`; `node scripts/bench.mjs --mode ctf --map island_old_summer --seconds 180 --seed 1`
   → JSON с `drownings: 0`, `captures ≥ 4`; повторить для kolhoz / deathtrack / madness.
2. Dev-оверлей `?debug=nav`: визуально проверить, что сетка не выходит за берег Island,
   рампы соединены, края террас разрезаны; пути ботов рисуются и следуются.
3. Ручная игра: CTF Island vs 6 ботов normal — боты доставляют флаги, эскорт виден,
   не тонут; TDM — отступают/лечатся.
4. Обновить `ARCHITECTURE.md` (новые папки/сервисы), `PLAN.md` (M1–M4), `CLAUDE.md`
   (правило: доступ к физике только через `model/engine/World.ts`).
